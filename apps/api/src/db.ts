import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

// SQLite (built into Node 24) keeps local dev at zero setup. The schema is plain SQL so it ports to Postgres as-is.
export function openDb(path = process.env.DATABASE_PATH ?? './data/mello.db'): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_token TEXT NOT NULL UNIQUE,
      pairing_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kids (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      device_token TEXT NOT NULL UNIQUE,
      push_token TEXT,
      installed_apps TEXT NOT NULL DEFAULT '[]',
      current_book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      kid_id TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
      apps TEXT NOT NULL,
      minutes_required INTEGER NOT NULL,
      unlock_minutes INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      author TEXT,
      age_level INTEGER,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      kid_id TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
      book_id TEXT,
      questions TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      kid_id TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
      book_id TEXT,
      seconds INTEGER NOT NULL,
      from_page INTEGER,
      to_page INTEGER,
      app_package TEXT,
      challenge_id TEXT,
      passed INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      kid_id TEXT NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('audio', 'tts')),
      text TEXT,
      audio_file TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      played_at TEXT
    );
  `);
  return db;
}

export const newId = () => randomUUID();
export const newToken = () => randomBytes(24).toString('base64url');
/** 6-digit code the parent reads out to pair a kid's phone. */
export const newPairingCode = () => String(100000 + (randomBytes(4).readUInt32BE() % 900000));
