import type { DatabaseSync } from 'node:sqlite';
import type { Book, BookInput, GeneratedChallenge, BookWithText, InstalledApp, Kid, Message, Rule, RuleInput } from '@mello/shared';
import { newId, newPairingCode, newToken } from './db.ts';
import { hashPassword, verifyPassword } from './password.ts';

type Row = Record<string, any>;

const toKid = (r: Row): Kid => ({
  id: r.id,
  name: r.name,
  currentBookId: r.current_book_id ?? null,
  installedApps: JSON.parse(r.installed_apps) as InstalledApp[],
});
const toRule = (r: Row): Rule => ({
  id: r.id,
  kidId: r.kid_id,
  apps: JSON.parse(r.apps),
  minutesRequired: r.minutes_required,
  unlockMinutes: r.unlock_minutes,
  enabled: !!r.enabled,
});
const toBook = (r: Row): Book => ({ id: r.id, title: r.title, author: r.author ?? null, ageLevel: r.age_level ?? null });
const toMessage = (r: Row, baseUrl: string): Message => ({
  id: r.id,
  kidId: r.kid_id,
  kind: r.kind,
  text: r.text ?? null,
  audioUrl: r.audio_file ? `${baseUrl}/audio/${r.audio_file}` : null,
  createdAt: r.created_at,
  playedAt: r.played_at ?? null,
});

/** All data access. Every method that takes a familyId scopes by it, so a parent can only touch their own kids. */
export class Repo {
  constructor(private db: DatabaseSync) {}

  // ----- families & pairing -----
  createFamily(name: string) {
    const family = { id: newId(), name, parentToken: newToken(), pairingCode: newPairingCode() };
    this.db
      .prepare('INSERT INTO families (id, name, parent_token, pairing_code) VALUES (?, ?, ?, ?)')
      .run(family.id, name, family.parentToken, family.pairingCode);
    return family;
  }
  familyByToken(token: string) {
    return this.db.prepare('SELECT id, name, pairing_code, parent_password IS NOT NULL AS has_password FROM families WHERE parent_token = ?').get(token) as Row | undefined;
  }
  pairKid(code: string, kidName: string) {
    const family = this.db.prepare('SELECT id FROM families WHERE pairing_code = ?').get(code) as Row | undefined;
    if (!family) return null;
    const kid = { id: newId(), deviceToken: newToken() };
    this.db
      .prepare('INSERT INTO kids (id, family_id, name, device_token) VALUES (?, ?, ?, ?)')
      .run(kid.id, family.id, kidName, kid.deviceToken);
    return kid;
  }
  kidByToken(token: string) {
    return this.db.prepare('SELECT * FROM kids WHERE device_token = ?').get(token) as Row | undefined;
  }
  setParentPassword(familyId: string, password: string) {
    this.db.prepare('UPDATE families SET parent_password = ? WHERE id = ?').run(hashPassword(password), familyId);
  }

  // ----- signing a kid's phone out -----
  static readonly MAX_UNPAIR_FAILURES = 5;
  static readonly UNPAIR_LOCK_MS = 15 * 60_000;

  /** Checks the parent password from the kid's phone. Five wrong tries lock it for 15 minutes. */
  tryUnpairWithPassword(kidId: string, password: string, now = Date.now()): 'ok' | 'wrong' | 'locked' | 'no-password' {
    const row = this.db
      .prepare('SELECT k.unpair_failures, k.unpair_locked_until, f.parent_password FROM kids k JOIN families f ON f.id = k.family_id WHERE k.id = ?')
      .get(kidId) as Row;
    if (!row.parent_password) return 'no-password';
    if (row.unpair_locked_until && row.unpair_locked_until > now) return 'locked';
    if (!verifyPassword(password, row.parent_password)) {
      const failures = row.unpair_failures + 1;
      const locked = failures >= Repo.MAX_UNPAIR_FAILURES;
      this.db
        .prepare('UPDATE kids SET unpair_failures = ?, unpair_locked_until = ? WHERE id = ?')
        .run(locked ? 0 : failures, locked ? now + Repo.UNPAIR_LOCK_MS : null, kidId);
      return locked ? 'locked' : 'wrong';
    }
    this.revokeKid(kidId);
    return 'ok';
  }
  revokeKid(kidId: string) {
    this.db.prepare(`UPDATE kids SET revoked_at = datetime('now'), push_token = NULL WHERE id = ?`).run(kidId);
    this.db.prepare(`UPDATE unpair_requests SET status = 'approved', decided_at = datetime('now') WHERE kid_id = ? AND status = 'pending'`).run(kidId);
  }
  /** Reuses a pending request so repeated taps don't flood the parent. */
  requestUnpair(kidId: string) {
    const pending = this.db.prepare(`SELECT id, status FROM unpair_requests WHERE kid_id = ? AND status = 'pending'`).get(kidId) as Row | undefined;
    if (pending) return { id: pending.id as string, status: 'pending' as const };
    const id = newId();
    this.db.prepare('INSERT INTO unpair_requests (id, kid_id) VALUES (?, ?)').run(id, kidId);
    return { id, status: 'pending' as const };
  }
  unpairRequestStatus(kidId: string, requestId: string) {
    const r = this.db.prepare('SELECT status FROM unpair_requests WHERE id = ? AND kid_id = ?').get(requestId, kidId) as Row | undefined;
    return (r?.status as 'pending' | 'approved' | 'denied' | undefined) ?? null;
  }
  pendingUnpairRequests(familyId: string) {
    return this.db
      .prepare(
        `SELECT r.id, r.kid_id AS kidId, k.name AS kidName, r.created_at AS createdAt FROM unpair_requests r
         JOIN kids k ON k.id = r.kid_id WHERE k.family_id = ? AND r.status = 'pending' AND k.revoked_at IS NULL ORDER BY r.created_at`,
      )
      .all(familyId) as { id: string; kidId: string; kidName: string; createdAt: string }[];
  }
  decideUnpairRequest(familyId: string, requestId: string, approve: boolean) {
    const r = this.db
      .prepare(`SELECT r.kid_id FROM unpair_requests r JOIN kids k ON k.id = r.kid_id WHERE r.id = ? AND k.family_id = ? AND r.status = 'pending'`)
      .get(requestId, familyId) as Row | undefined;
    if (!r) return false;
    if (approve) this.revokeKid(r.kid_id);
    else this.db.prepare(`UPDATE unpair_requests SET status = 'denied', decided_at = datetime('now') WHERE id = ?`).run(requestId);
    return true;
  }

  // ----- kids -----
  listKids(familyId: string): Kid[] {
    return (this.db.prepare('SELECT * FROM kids WHERE family_id = ? AND revoked_at IS NULL ORDER BY created_at').all(familyId) as Row[]).map(toKid);
  }
  getKid(familyId: string, kidId: string): Kid | null {
    const r = this.db.prepare('SELECT * FROM kids WHERE id = ? AND family_id = ? AND revoked_at IS NULL').get(kidId, familyId) as Row | undefined;
    return r ? toKid(r) : null;
  }
  findKidByName(familyId: string, name: string): Kid | null {
    const r = this.db
      .prepare('SELECT * FROM kids WHERE family_id = ? AND revoked_at IS NULL AND lower(name) = lower(?)')
      .get(familyId, name.trim()) as Row | undefined;
    return r ? toKid(r) : null;
  }
  updateDevice(kidId: string, pushToken: string | null, installedApps: InstalledApp[] | null) {
    if (pushToken !== null) this.db.prepare('UPDATE kids SET push_token = ? WHERE id = ?').run(pushToken, kidId);
    if (installedApps !== null)
      this.db.prepare('UPDATE kids SET installed_apps = ? WHERE id = ?').run(JSON.stringify(installedApps), kidId);
  }
  pushToken(kidId: string): string | null {
    const r = this.db.prepare('SELECT push_token FROM kids WHERE id = ?').get(kidId) as Row | undefined;
    return r?.push_token ?? null;
  }
  setCurrentBook(familyId: string, kidId: string, bookId: string) {
    if (!this.getBook(familyId, bookId)) return false;
    const res = this.db.prepare('UPDATE kids SET current_book_id = ? WHERE id = ? AND family_id = ?').run(bookId, kidId, familyId);
    return res.changes > 0;
  }

  // ----- rules -----
  listRules(kidId: string): Rule[] {
    return (this.db.prepare('SELECT * FROM rules WHERE kid_id = ?').all(kidId) as Row[]).map(toRule);
  }
  addRule(kidId: string, input: RuleInput): Rule {
    const rule: Rule = { id: newId(), kidId, ...input };
    this.db
      .prepare('INSERT INTO rules (id, kid_id, apps, minutes_required, unlock_minutes, enabled) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rule.id, kidId, JSON.stringify(rule.apps), rule.minutesRequired, rule.unlockMinutes, rule.enabled ? 1 : 0);
    return rule;
  }
  deleteRule(familyId: string, ruleId: string) {
    const res = this.db
      .prepare('DELETE FROM rules WHERE id = ? AND kid_id IN (SELECT id FROM kids WHERE family_id = ?)')
      .run(ruleId, familyId);
    return res.changes > 0;
  }

  // ----- books -----
  addBook(familyId: string, input: BookInput): Book {
    const id = newId();
    this.db
      .prepare('INSERT INTO books (id, family_id, title, author, age_level, text) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, familyId, input.title, input.author ?? null, input.ageLevel ?? null, input.text);
    return { id, title: input.title, author: input.author ?? null, ageLevel: input.ageLevel ?? null };
  }
  listBooks(familyId: string): Book[] {
    return (this.db.prepare('SELECT * FROM books WHERE family_id = ? ORDER BY created_at').all(familyId) as Row[]).map(toBook);
  }
  getBook(familyId: string, bookId: string): BookWithText | null {
    const r = this.db.prepare('SELECT * FROM books WHERE id = ? AND family_id = ?').get(bookId, familyId) as Row | undefined;
    return r ? { ...toBook(r), text: r.text } : null;
  }

  // ----- challenges & sessions -----
  /** Stores the full generated challenge, answers included; only the server ever sees answerIndex. */
  saveChallenge(kidId: string, bookId: string | null, challenge: GeneratedChallenge) {
    const id = newId();
    this.db.prepare('INSERT INTO challenges (id, kid_id, book_id, questions) VALUES (?, ?, ?, ?)').run(id, kidId, bookId, JSON.stringify(challenge));
    return id;
  }
  getChallenge(kidId: string, id: string) {
    const r = this.db.prepare('SELECT * FROM challenges WHERE id = ? AND kid_id = ?').get(id, kidId) as Row | undefined;
    return r ? { challenge: JSON.parse(r.questions) as GeneratedChallenge, result: r.result ? JSON.parse(r.result) : null } : null;
  }
  setChallengeResult(id: string, result: unknown) {
    this.db.prepare('UPDATE challenges SET result = ? WHERE id = ?').run(JSON.stringify(result), id);
  }
  addSession(kidId: string, s: { bookId?: string; seconds: number; fromPage?: number; toPage?: number; appPackage?: string; challengeId?: string; passed?: boolean }) {
    this.db
      .prepare(
        'INSERT INTO sessions (id, kid_id, book_id, seconds, from_page, to_page, app_package, challenge_id, passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(newId(), kidId, s.bookId ?? null, s.seconds, s.fromPage ?? null, s.toPage ?? null, s.appPackage ?? null, s.challengeId ?? null, s.passed === undefined ? null : s.passed ? 1 : 0);
  }
  report(kidId: string, days: number) {
    const since = `-${Math.max(1, Math.min(days, 90))} days`;
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS sessions, COALESCE(SUM(seconds), 0) AS seconds,
                SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passed,
                SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) AS failed
         FROM sessions WHERE kid_id = ? AND created_at >= datetime('now', ?)`,
      )
      .get(kidId, since) as Row;
    const byDay = this.db
      .prepare(
        `SELECT date(created_at) AS day, SUM(seconds) AS seconds FROM sessions
         WHERE kid_id = ? AND created_at >= datetime('now', ?) GROUP BY day ORDER BY day`,
      )
      .all(kidId, since) as Row[];
    const apps = this.db
      .prepare(
        `SELECT app_package AS app, COUNT(*) AS unlocks FROM sessions
         WHERE kid_id = ? AND passed = 1 AND app_package IS NOT NULL AND created_at >= datetime('now', ?)
         GROUP BY app_package ORDER BY unlocks DESC`,
      )
      .all(kidId, since) as Row[];
    return {
      days,
      sessions: totals.sessions,
      minutesRead: Math.round(totals.seconds / 60),
      challengesPassed: totals.passed ?? 0,
      challengesFailed: totals.failed ?? 0,
      minutesByDay: byDay.map((d) => ({ day: d.day, minutes: Math.round(d.seconds / 60) })),
      unlocksByApp: apps.map((a) => ({ app: a.app, unlocks: a.unlocks })),
    };
  }

  // ----- messages -----
  addMessage(kidId: string, kind: 'audio' | 'tts', text: string | null, audioFile: string | null) {
    const id = newId();
    this.db.prepare('INSERT INTO messages (id, kid_id, kind, text, audio_file) VALUES (?, ?, ?, ?, ?)').run(id, kidId, kind, text, audioFile);
    return id;
  }
  listMessages(kidId: string, baseUrl: string, unplayedOnly: boolean): Message[] {
    const sql = `SELECT * FROM messages WHERE kid_id = ? ${unplayedOnly ? 'AND played_at IS NULL' : ''} ORDER BY created_at DESC LIMIT 50`;
    return (this.db.prepare(sql).all(kidId) as Row[]).map((r) => toMessage(r, baseUrl));
  }
  markPlayed(kidId: string, messageId: string) {
    return this.db.prepare(`UPDATE messages SET played_at = datetime('now') WHERE id = ? AND kid_id = ?`).run(messageId, kidId).changes > 0;
  }
}
