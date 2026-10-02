import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** The one thing the repo needs from a database: parameterised SQL ($1, $2, …) returning rows. */
export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/**
 * DATABASE_URL set → Supabase Postgres (production and shared dev).
 * Otherwise → PGlite, an in-process Postgres, on disk under ./data (or in memory for tests),
 * running the same schema file, so local dev needs no setup.
 */
export async function openDb(opts: { url?: string; pglitePath?: string } = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) return openPostgres(url);
  return openPglite(opts.pglitePath ?? process.env.PGLITE_PATH ?? './data/pglite');
}

async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  // Supabase's transaction pooler (port 6543) doesn't support prepared statements.
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 30 });
  return {
    query: async (text, params = []) => (await sql.unsafe(text, params as any[])) as any,
    close: () => sql.end(),
  };
}

async function openPglite(path: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (path !== 'memory://') mkdirSync(path, { recursive: true });
  const db = new PGlite(path);
  await db.exec(readFileSync(join(SQL_DIR, '001_core.sql'), 'utf8'));
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows as any,
    close: () => db.close(),
  };
}

export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** 6-digit code the parent reads out to pair a kid's phone. */
export const newPairingCode = () => String(100000 + (randomBytes(4).readUInt32BE() % 900000));
