import type {
  AppLimit,
  Alert,
  Book,
  BookInput,
  BookWithText,
  DeviceStatus,
  GeneratedChallenge,
  InstalledApp,
  Kid,
  KidSettings,
  SelfProfile,
  SelfProfileInput,
  UsageDay,
  Message,
  QuietHours,
  Rule,
  RuleInput,
  Task,
  TaskInput,
  TaskProgress,
} from '@mello/shared';
import { KidSettings as KidSettingsSchema } from '@mello/shared';
import { hashToken, newPairingCode, newToken, type Db } from './db.ts';
import { hashPassword, verifyPassword } from './password.ts';

type Row = Record<string, any>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

const toKid = (r: Row): Kid => ({
  id: r.id,
  kind: r.kind ?? 'kid',
  name: r.name,
  currentBookId: r.current_book_id ?? null,
  installedApps: r.installed_apps as InstalledApp[],
  settings: KidSettingsSchema.parse(r.settings ?? {}),
  deviceStatus: (r.device_status ?? {}) as DeviceStatus,
  lastSeenAt: iso(r.last_seen_at),
});
const toRule = (r: Row): Rule => ({
  id: r.id,
  kidId: r.kid_id,
  apps: r.apps,
  activity: r.activity,
  taskId: r.task_id ?? null,
  minutesRequired: r.minutes_required,
  unlockMinutes: r.unlock_minutes,
  enabled: r.enabled,
});
const toBook = (r: Row): Book => ({ id: r.id, title: r.title, author: r.author ?? null, ageLevel: r.age_level ?? null });
const toTask = (r: Row): Task => ({
  id: r.id,
  kidId: r.kid_id,
  kind: r.kind,
  title: r.title,
  url: r.url ?? null,
  bookId: r.book_id ?? null,
  appPackage: r.app_package ?? null,
  requiredMinutes: r.required_minutes,
  repeat: r.repeat,
  active: r.active,
});
const toMessage = (r: Row, baseUrl: string): Message => ({
  id: r.id,
  kidId: r.kid_id,
  kind: r.kind,
  text: r.text ?? null,
  audioUrl: r.audio_file ? `${baseUrl}/audio/${r.audio_file}` : null,
  createdAt: iso(r.created_at)!,
  playedAt: iso(r.played_at),
});

export class NotFound extends Error {}

/**
 * All data access. Methods that take a familyId scope by it, so a parent can only reach their own
 * family; kid-device methods take the kidId resolved from the device token.
 */
export class Repo {
  static readonly MAX_UNPAIR_FAILURES = 5;
  static readonly UNPAIR_LOCK_MS = 15 * 60_000;

  constructor(private db: Db) {}

  private async one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.db.query<T>(sql, params))[0] ?? null) as T | null;
  }

  // ----- parents & families -----
  async familyForUser(userId: string) {
    return this.one<{ id: string; name: string; pairing_code: string; has_password: boolean }>(
      `select f.id, f.name, f.pairing_code, f.parent_password is not null as has_password
       from families f join family_members m on m.family_id = f.id where m.user_id = $1 limit 1`,
      [userId],
    );
  }
  async createFamily(userId: string, name: string) {
    // Retry on the (unlikely) pairing-code collision.
    for (let i = 0; i < 5; i++) {
      try {
        const f = await this.one<{ id: string }>(`insert into families (name, pairing_code) values ($1, $2) returning id`, [name, newPairingCode()]);
        await this.db.query(`insert into family_members (family_id, user_id) values ($1, $2)`, [f!.id, userId]);
        return (await this.familyForUser(userId))!;
      } catch (err: any) {
        if (err?.code !== '23505' || !String(err?.detail ?? err?.message).includes('pairing_code')) throw err;
      }
    }
    throw new Error('Could not allocate a pairing code');
  }
  async setParentPassword(familyId: string, password: string) {
    await this.db.query(`update families set parent_password = $1 where id = $2`, [hashPassword(password), familyId]);
  }

  // ----- kid devices -----
  async pairKid(code: string, kidName: string) {
    const family = await this.one<{ id: string }>(`select id from families where pairing_code = $1`, [code]);
    if (!family) return null;
    const deviceToken = newToken();
    const kid = await this.one<{ id: string }>(
      `insert into kids (family_id, name, device_token_hash) values ($1, $2, $3) returning id`,
      [family.id, kidName, hashToken(deviceToken)],
    );
    return { id: kid!.id, deviceToken };
  }
  async kidByToken(token: string) {
    return this.one<{ id: string; family_id: string; revoked_at: Date | null }>(
      `update kids set last_seen_at = now() where device_token_hash = $1 returning id, family_id, revoked_at`,
      [hashToken(token)],
    );
  }

  // ----- self mode (someone coaching their own phone) -----
  /**
   * Creates (or, on a new phone, re-issues) the user's self subject and returns a fresh device token.
   * The old phone's token stops working. Reuses the user's family if they are also a parent.
   */
  async setupSelf(userId: string, name: string) {
    const family = (await this.familyForUser(userId)) ?? (await this.createFamily(userId, 'Just me'));
    const deviceToken = newToken();
    const existing = await this.one<{ subject_id: string }>(`select subject_id from self_profiles where user_id = $1`, [userId]);
    if (existing) {
      await this.db.query(
        `update kids set device_token_hash = $2, revoked_at = null, push_token = null, name = $3 where id = $1`,
        [existing.subject_id, hashToken(deviceToken), name],
      );
      return { subjectId: existing.subject_id, deviceToken };
    }
    const subject = await this.one<{ id: string }>(
      `insert into kids (family_id, name, device_token_hash, kind) values ($1, $2, $3, 'self') returning id`,
      [family.id, name, hashToken(deviceToken)],
    );
    await this.db.query(`insert into self_profiles (user_id, subject_id) values ($1, $2)`, [userId, subject!.id]);
    return { subjectId: subject!.id, deviceToken };
  }
  async selfProfile(userId: string): Promise<(SelfProfile & { familyId: string; revoked: boolean }) | null> {
    const r = await this.one(
      `select p.subject_id, p.interests, p.always_suggest, k.name, k.settings, k.family_id, k.revoked_at
       from self_profiles p join kids k on k.id = p.subject_id where p.user_id = $1`,
      [userId],
    );
    if (!r) return null;
    return {
      subjectId: r.subject_id,
      name: r.name,
      interests: r.interests ?? [],
      alwaysSuggest: r.always_suggest,
      character: KidSettingsSchema.parse(r.settings ?? {}).character,
      familyId: r.family_id,
      revoked: !!r.revoked_at,
    };
  }
  async updateSelfProfile(userId: string, patch: SelfProfileInput) {
    const p = await this.selfProfile(userId);
    if (!p) return null;
    if (patch.name) await this.db.query(`update kids set name = $2 where id = $1`, [p.subjectId, patch.name]);
    if (patch.character) await this.db.query(`update kids set settings = settings || $2::jsonb where id = $1`, [p.subjectId, JSON.stringify({ character: patch.character })]);
    if (patch.interests || patch.alwaysSuggest !== undefined) {
      await this.db.query(`update self_profiles set interests = coalesce($2, interests), always_suggest = coalesce($3, always_suggest) where user_id = $1`, [
        userId,
        patch.interests ?? null,
        patch.alwaysSuggest ?? null,
      ]);
    }
    return this.selfProfile(userId);
  }
  /** Upserts one day of aggregates and drops anything older than 30 days. */
  async putUsageDay(subjectId: string, usage: UsageDay) {
    const { day, ...data } = usage;
    await this.db.query(
      `insert into usage_days (subject_id, day, data) values ($1, $2::date, $3::jsonb)
       on conflict (subject_id, day) do update set data = excluded.data, updated_at = now()`,
      [subjectId, day, JSON.stringify(data)],
    );
    await this.db.query(`delete from usage_days where subject_id = $1 and day < current_date - 30`, [subjectId]);
  }
  /** Most recent first. */
  async usageDays(subjectId: string, days: number): Promise<UsageDay[]> {
    const rows = await this.db.query(
      `select to_char(day, 'YYYY-MM-DD') as day, data from usage_days where subject_id = $1 order by day desc limit $2`,
      [subjectId, Math.max(1, Math.min(days, 30))],
    );
    return rows.map((r) => ({ day: r.day, ...r.data }) as UsageDay);
  }
  async addReflection(subjectId: string, r: { title: string | null; questions: string[]; answers: string[]; reply: string | null }) {
    await this.db.query(`insert into reflections (subject_id, title, questions, answers, reply) values ($1, $2, $3::jsonb, $4::jsonb, $5)`, [
      subjectId,
      r.title,
      JSON.stringify(r.questions),
      JSON.stringify(r.answers),
      r.reply,
    ]);
  }
  async recentReflections(subjectId: string, limit = 5) {
    const rows = await this.db.query(`select title, answers, created_at from reflections where subject_id = $1 order by created_at desc limit $2`, [subjectId, limit]);
    return rows.map((r) => ({ title: r.title as string | null, answers: r.answers as string[], createdAt: iso(r.created_at)! }));
  }
  /** "Delete my data": usage, reflections, sessions and alerts. Rules and goals stay so the phone keeps working. */
  async deleteSelfData(subjectId: string) {
    for (const table of ['usage_days', 'reflections']) await this.db.query(`delete from ${table} where subject_id = $1`, [subjectId]);
    for (const table of ['sessions', 'alerts', 'challenges', 'task_progress']) await this.db.query(`delete from ${table} where kid_id = $1`, [subjectId]);
  }

  // ----- kids -----
  async listKids(familyId: string): Promise<Kid[]> {
    return (await this.db.query(`select * from kids where family_id = $1 and kind = 'kid' and revoked_at is null order by created_at`, [familyId])).map(toKid);
  }
  async getKid(familyId: string, kidId: string): Promise<Kid | null> {
    const r = await this.one(`select * from kids where id = $1 and family_id = $2 and revoked_at is null`, [kidId, familyId]);
    return r ? toKid(r) : null;
  }
  async findKidByName(familyId: string, name: string): Promise<Kid | null> {
    const r = await this.one(`select * from kids where family_id = $1 and kind = 'kid' and revoked_at is null and lower(name) = lower($2)`, [familyId, name.trim()]);
    return r ? toKid(r) : null;
  }
  async updateDevice(kidId: string, d: { pushToken?: string | null; installedApps?: InstalledApp[] | null; status?: DeviceStatus | null }) {
    const before = await this.one<{ device_status: DeviceStatus }>(`select device_status from kids where id = $1`, [kidId]);
    await this.db.query(
      `update kids set
         push_token = coalesce($2, push_token),
         installed_apps = coalesce($3::jsonb, installed_apps),
         device_status = device_status || coalesce($4::jsonb, '{}'::jsonb)
       where id = $1`,
      [kidId, d.pushToken ?? null, d.installedApps ? JSON.stringify(d.installedApps) : null, d.status ? JSON.stringify(d.status) : null],
    );
    // Protections switched off since the last report → tell the parent.
    const prev = before?.device_status ?? {};
    for (const key of ['gateEnabled', 'deviceAdminEnabled', 'usageAccessEnabled', 'overlayEnabled'] as const) {
      if (prev[key] === true && d.status?.[key] === false) await this.addAlert(kidId, 'protection_off', { protection: key });
    }
  }
  async updateSettings(familyId: string, kidId: string, patch: Partial<KidSettings>) {
    const r = await this.one(
      `update kids set settings = settings || $3::jsonb where id = $1 and family_id = $2 returning *`,
      [kidId, familyId, JSON.stringify(patch)],
    );
    return r ? toKid(r) : null;
  }
  async pushToken(kidId: string): Promise<string | null> {
    return (await this.one<{ push_token: string | null }>(`select push_token from kids where id = $1`, [kidId]))?.push_token ?? null;
  }
  async setCurrentBook(familyId: string, kidId: string, bookId: string) {
    if (!(await this.getBook(familyId, bookId))) return false;
    const r = await this.db.query(`update kids set current_book_id = $1 where id = $2 and family_id = $3 returning id`, [bookId, kidId, familyId]);
    return r.length > 0;
  }

  // ----- signing a kid's phone out -----
  async tryUnpairWithPassword(kidId: string, password: string, now = Date.now()): Promise<'ok' | 'wrong' | 'locked' | 'no-password'> {
    const row = await this.one<{ unpair_failures: number; unpair_locked_until: Date | null; parent_password: string | null }>(
      `select k.unpair_failures, k.unpair_locked_until, f.parent_password from kids k join families f on f.id = k.family_id where k.id = $1`,
      [kidId],
    );
    if (!row?.parent_password) return 'no-password';
    if (row.unpair_locked_until && new Date(row.unpair_locked_until).getTime() > now) return 'locked';
    if (!verifyPassword(password, row.parent_password)) {
      const failures = row.unpair_failures + 1;
      const locked = failures >= Repo.MAX_UNPAIR_FAILURES;
      await this.db.query(`update kids set unpair_failures = $2, unpair_locked_until = $3 where id = $1`, [
        kidId,
        locked ? 0 : failures,
        locked ? new Date(now + Repo.UNPAIR_LOCK_MS) : null,
      ]);
      return locked ? 'locked' : 'wrong';
    }
    await this.revokeKid(kidId);
    return 'ok';
  }
  async revokeKid(kidId: string) {
    await this.db.query(`update kids set revoked_at = now(), push_token = null where id = $1`, [kidId]);
    await this.db.query(`update unpair_requests set status = 'approved', decided_at = now() where kid_id = $1 and status = 'pending'`, [kidId]);
  }
  /** Reuses a pending request so repeated taps don't flood the parent. */
  async requestUnpair(kidId: string) {
    const pending = await this.one<{ id: string }>(`select id from unpair_requests where kid_id = $1 and status = 'pending'`, [kidId]);
    const id = pending?.id ?? (await this.one<{ id: string }>(`insert into unpair_requests (kid_id) values ($1) returning id`, [kidId]))!.id;
    return { id, status: 'pending' as const };
  }
  async unpairRequestStatus(kidId: string, requestId: string) {
    const r = await this.one<{ status: 'pending' | 'approved' | 'denied' }>(`select status from unpair_requests where id = $1 and kid_id = $2`, [requestId, kidId]);
    return r?.status ?? null;
  }
  async pendingUnpairRequests(familyId: string) {
    const rows = await this.db.query(
      `select r.id, r.kid_id, k.name as kid_name, r.created_at from unpair_requests r join kids k on k.id = r.kid_id
       where k.family_id = $1 and r.status = 'pending' and k.revoked_at is null order by r.created_at`,
      [familyId],
    );
    return rows.map((r) => ({ id: r.id as string, kidId: r.kid_id as string, kidName: r.kid_name as string, createdAt: iso(r.created_at)! }));
  }
  async decideUnpairRequest(familyId: string, requestId: string, approve: boolean) {
    const r = await this.one<{ kid_id: string }>(
      `select r.kid_id from unpair_requests r join kids k on k.id = r.kid_id where r.id = $1 and k.family_id = $2 and r.status = 'pending'`,
      [requestId, familyId],
    );
    if (!r) return false;
    if (approve) await this.revokeKid(r.kid_id);
    else await this.db.query(`update unpair_requests set status = 'denied', decided_at = now() where id = $1`, [requestId]);
    return true;
  }

  // ----- rules -----
  async listRules(kidId: string): Promise<Rule[]> {
    return (await this.db.query(`select * from rules where kid_id = $1`, [kidId])).map(toRule);
  }
  async addRule(kidId: string, input: RuleInput): Promise<Rule> {
    if (input.taskId && !(await this.one(`select 1 from tasks where id = $1 and kid_id = $2`, [input.taskId, kidId]))) {
      throw new NotFound('Task not found for this kid');
    }
    const r = await this.one(
      `insert into rules (kid_id, apps, activity, task_id, minutes_required, unlock_minutes, enabled)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [kidId, input.apps, input.activity, input.taskId, input.minutesRequired, input.unlockMinutes, input.enabled],
    );
    return toRule(r!);
  }
  async deleteRule(familyId: string, ruleId: string) {
    const r = await this.db.query(`delete from rules where id = $1 and kid_id in (select id from kids where family_id = $2) returning id`, [ruleId, familyId]);
    return r.length > 0;
  }

  // ----- tasks -----
  async listTasks(kidId: string, activeOnly = false): Promise<Task[]> {
    return (await this.db.query(`select * from tasks where kid_id = $1 ${activeOnly ? 'and active' : ''} order by created_at`, [kidId])).map(toTask);
  }
  async addTask(familyId: string, kidId: string, input: TaskInput): Promise<Task> {
    if (input.bookId && !(await this.getBook(familyId, input.bookId))) throw new NotFound('Book not found');
    const r = await this.one(
      `insert into tasks (kid_id, kind, title, url, book_id, app_package, required_minutes, repeat) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [kidId, input.kind, input.title, input.url, input.bookId, input.appPackage, input.requiredMinutes, input.repeat],
    );
    return toTask(r!);
  }
  async deleteTask(familyId: string, taskId: string) {
    const r = await this.db.query(`delete from tasks where id = $1 and kid_id in (select id from kids where family_id = $2) returning id`, [taskId, familyId]);
    return r.length > 0;
  }
  /** Progress for the kid's local day. `day` comes from the phone (YYYY-MM-DD) so "today" matches the kid's clock. */
  async taskProgress(kidId: string, day: string): Promise<TaskProgress[]> {
    const rows = await this.db.query(
      `select t.id, coalesce(p.seconds, 0)::int as seconds,
              (p.completed_at is not null or (t.repeat = 'once' and exists (
                 select 1 from task_progress x where x.task_id = t.id and x.completed_at is not null))) as completed
       from tasks t left join task_progress p on p.task_id = t.id and p.day = $2::date
       where t.kid_id = $1 and t.active`,
      [kidId, day],
    );
    return rows.map((r) => ({ taskId: r.id, seconds: Number(r.seconds), completed: !!r.completed }));
  }
  /**
   * Adds verified seconds to today's progress. The phone reports small increments (≤ 5 min each)
   * so a replayed or forged request can't complete a long task in one go.
   */
  async addTaskProgress(kidId: string, taskId: string, day: string, seconds: number): Promise<TaskProgress | null> {
    const task = await this.one<{ required_minutes: number }>(`select required_minutes from tasks where id = $1 and kid_id = $2 and active`, [taskId, kidId]);
    if (!task) return null;
    const r = await this.one<{ seconds: number; completed_at: Date | null }>(
      `insert into task_progress (task_id, kid_id, day, seconds) values ($1, $2, $3::date, $4)
       on conflict (task_id, day) do update set seconds = task_progress.seconds + excluded.seconds
       returning seconds, completed_at`,
      [taskId, kidId, day, seconds],
    );
    let completed = !!r!.completed_at;
    if (!completed && r!.seconds >= task.required_minutes * 60) {
      await this.db.query(`update task_progress set completed_at = now() where task_id = $1 and day = $2::date`, [taskId, day]);
      completed = true;
    }
    return { taskId, seconds: r!.seconds, completed };
  }

  // ----- limits & bedtime -----
  async listLimits(kidId: string): Promise<AppLimit[]> {
    const rows = await this.db.query(`select package_name, daily_minutes from app_limits where kid_id = $1 order by package_name`, [kidId]);
    return rows.map((r) => ({ packageName: r.package_name, dailyMinutes: r.daily_minutes }));
  }
  async setLimit(kidId: string, limit: AppLimit) {
    await this.db.query(
      `insert into app_limits (kid_id, package_name, daily_minutes) values ($1, $2, $3)
       on conflict (kid_id, package_name) do update set daily_minutes = excluded.daily_minutes`,
      [kidId, limit.packageName, limit.dailyMinutes],
    );
  }
  async deleteLimit(kidId: string, packageName: string) {
    return (await this.db.query(`delete from app_limits where kid_id = $1 and package_name = $2 returning id`, [kidId, packageName])).length > 0;
  }
  async getQuietHours(kidId: string): Promise<QuietHours | null> {
    const r = await this.one(`select * from quiet_hours where kid_id = $1`, [kidId]);
    return r ? { enabled: r.enabled, startMinute: r.start_minute, endMinute: r.end_minute, allowedApps: r.allowed_apps } : null;
  }
  async setQuietHours(kidId: string, q: QuietHours) {
    await this.db.query(
      `insert into quiet_hours (kid_id, enabled, start_minute, end_minute, allowed_apps) values ($1, $2, $3, $4, $5)
       on conflict (kid_id) do update set enabled = excluded.enabled, start_minute = excluded.start_minute,
         end_minute = excluded.end_minute, allowed_apps = excluded.allowed_apps`,
      [kidId, q.enabled, q.startMinute, q.endMinute, q.allowedApps],
    );
  }

  // ----- books -----
  async addBook(familyId: string, input: BookInput & { source?: 'pasted' | 'file' | 'sample' }): Promise<Book> {
    const r = await this.one(
      `insert into books (family_id, title, author, age_level, text, source) values ($1, $2, $3, $4, $5, $6) returning *`,
      [familyId, input.title, input.author ?? null, input.ageLevel ?? null, input.text, input.source ?? 'pasted'],
    );
    return toBook(r!);
  }
  async listBooks(familyId: string): Promise<Book[]> {
    return (await this.db.query(`select id, title, author, age_level from books where family_id = $1 order by created_at`, [familyId])).map(toBook);
  }
  async getBook(familyId: string, bookId: string): Promise<BookWithText | null> {
    const r = await this.one(`select * from books where id = $1 and family_id = $2`, [bookId, familyId]);
    return r ? { ...toBook(r), text: r.text } : null;
  }

  // ----- challenges & sessions -----
  /** Stores the full generated challenge, answers included; only the server ever sees answerIndex. */
  async saveChallenge(kidId: string, bookId: string | null, challenge: GeneratedChallenge) {
    return (await this.one<{ id: string }>(`insert into challenges (kid_id, book_id, questions) values ($1, $2, $3) returning id`, [
      kidId,
      bookId,
      JSON.stringify(challenge),
    ]))!.id;
  }
  async getChallenge(kidId: string, id: string) {
    const r = await this.one(`select questions, result from challenges where id = $1 and kid_id = $2`, [id, kidId]);
    return r ? { challenge: r.questions as GeneratedChallenge, result: r.result ?? null } : null;
  }
  async setChallengeResult(id: string, result: unknown) {
    await this.db.query(`update challenges set result = $2 where id = $1`, [id, JSON.stringify(result)]);
  }
  async addSession(
    kidId: string,
    s: { bookId?: string; taskId?: string; seconds: number; fromPage?: number; toPage?: number; appPackage?: string; challengeId?: string; passed?: boolean },
  ) {
    await this.db.query(
      `insert into sessions (kid_id, book_id, task_id, seconds, from_page, to_page, app_package, challenge_id, passed)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [kidId, s.bookId ?? null, s.taskId ?? null, s.seconds, s.fromPage ?? null, s.toPage ?? null, s.appPackage ?? null, s.challengeId ?? null, s.passed ?? null],
    );
  }
  async report(kidId: string, days: number) {
    const window = Math.max(1, Math.min(Number.isFinite(days) ? days : 7, 90));
    const since = `${window} days`;
    const totals = (await this.one(
      `select count(*)::int as sessions, coalesce(sum(seconds), 0)::int as seconds,
              count(*) filter (where passed)::int as passed, count(*) filter (where passed = false)::int as failed
       from sessions where kid_id = $1 and created_at >= now() - $2::interval`,
      [kidId, since],
    ))!;
    const byDay = await this.db.query(
      `select to_char(created_at, 'YYYY-MM-DD') as day, sum(seconds)::int as seconds from sessions
       where kid_id = $1 and created_at >= now() - $2::interval group by 1 order by 1`,
      [kidId, since],
    );
    const apps = await this.db.query(
      `select app_package as app, count(*)::int as unlocks from sessions
       where kid_id = $1 and passed and app_package is not null and created_at >= now() - $2::interval
       group by 1 order by 2 desc`,
      [kidId, since],
    );
    const tasks = await this.db.query(
      `select t.title, count(p.completed_at)::int as completed_days, coalesce(sum(p.seconds), 0)::int as seconds
       from tasks t left join task_progress p on p.task_id = t.id and p.day >= current_date - $2::interval
       where t.kid_id = $1 group by t.id, t.title order by t.title`,
      [kidId, since],
    );
    return {
      days: window,
      sessions: totals.sessions,
      minutesRead: Math.round(totals.seconds / 60),
      challengesPassed: totals.passed,
      challengesFailed: totals.failed,
      minutesByDay: byDay.map((d) => ({ day: d.day, minutes: Math.round(d.seconds / 60) })),
      unlocksByApp: apps.map((a) => ({ app: a.app, unlocks: a.unlocks })),
      tasks: tasks.map((t) => ({ title: t.title, completedDays: t.completed_days, minutes: Math.round(t.seconds / 60) })),
    };
  }

  // ----- messages -----
  async addMessage(kidId: string, kind: 'audio' | 'tts', text: string | null, audioFile: string | null) {
    return (await this.one<{ id: string }>(`insert into messages (kid_id, kind, text, audio_file) values ($1, $2, $3, $4) returning id`, [
      kidId,
      kind,
      text,
      audioFile,
    ]))!.id;
  }
  async listMessages(kidId: string, baseUrl: string, unplayedOnly: boolean): Promise<Message[]> {
    const rows = await this.db.query(
      `select * from messages where kid_id = $1 ${unplayedOnly ? 'and played_at is null' : ''} order by created_at desc limit 50`,
      [kidId],
    );
    return rows.map((r) => toMessage(r, baseUrl));
  }
  async markPlayed(kidId: string, messageId: string) {
    return (await this.db.query(`update messages set played_at = now() where id = $1 and kid_id = $2 returning id`, [messageId, kidId])).length > 0;
  }

  // ----- alerts & location -----
  async addAlert(kidId: string, kind: string, detail: Record<string, unknown> = {}) {
    // Collapse repeats: the same alert within 10 minutes is noise.
    const recent = await this.one(
      `select 1 from alerts where kid_id = $1 and kind = $2 and detail = $3::jsonb and created_at > now() - interval '10 minutes'`,
      [kidId, kind, JSON.stringify(detail)],
    );
    if (!recent) await this.db.query(`insert into alerts (kid_id, kind, detail) values ($1, $2, $3)`, [kidId, kind, JSON.stringify(detail)]);
  }
  async listAlerts(familyId: string, unseenOnly = true): Promise<Alert[]> {
    const rows = await this.db.query(
      `select a.*, k.name as kid_name from alerts a join kids k on k.id = a.kid_id
       where k.family_id = $1 and k.kind = 'kid' ${unseenOnly ? 'and a.seen_at is null' : ''} order by a.created_at desc limit 50`,
      [familyId],
    );
    return rows.map((r) => ({ id: r.id, kidId: r.kid_id, kidName: r.kid_name, kind: r.kind, detail: r.detail, createdAt: iso(r.created_at)! }));
  }
  async markAlertsSeen(familyId: string) {
    await this.db.query(`update alerts set seen_at = now() where seen_at is null and kid_id in (select id from kids where family_id = $1)`, [familyId]);
  }
  async addLocation(kidId: string, lat: number, lng: number, accuracyM: number | null) {
    await this.db.query(`insert into locations (kid_id, lat, lng, accuracy_m) values ($1, $2, $3, $4)`, [kidId, lat, lng, accuracyM]);
  }
  async lastLocation(kidId: string) {
    const r = await this.one(`select lat, lng, accuracy_m, recorded_at from locations where kid_id = $1 order by recorded_at desc limit 1`, [kidId]);
    return r ? { lat: r.lat, lng: r.lng, accuracyM: r.accuracy_m, recordedAt: iso(r.recorded_at)! } : null;
  }
}
