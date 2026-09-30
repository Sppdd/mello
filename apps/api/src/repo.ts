import type { DatabaseSync } from 'node:sqlite';
import type { Book, BookInput, GeneratedChallenge, BookWithText, InstalledApp, Kid, Message, Rule, RuleInput } from '@mello/shared';
import { newId, newPairingCode, newToken } from './db.ts';

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
    return this.db.prepare('SELECT id, name, pairing_code FROM families WHERE parent_token = ?').get(token) as Row | undefined;
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

  // ----- kids -----
  listKids(familyId: string): Kid[] {
    return (this.db.prepare('SELECT * FROM kids WHERE family_id = ? ORDER BY created_at').all(familyId) as Row[]).map(toKid);
  }
  getKid(familyId: string, kidId: string): Kid | null {
    const r = this.db.prepare('SELECT * FROM kids WHERE id = ? AND family_id = ?').get(kidId, familyId) as Row | undefined;
    return r ? toKid(r) : null;
  }
  findKidByName(familyId: string, name: string): Kid | null {
    const r = this.db
      .prepare('SELECT * FROM kids WHERE family_id = ? AND lower(name) = lower(?)')
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
