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
/** Schema files that run on any Postgres; 002_supabase.sql and 004_supabase_self.sql are Supabase-only. */
const PORTABLE_SQL = ['001_core.sql', '003_self.sql'];

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
  // The repo passes JSON already stringified (that's what PGlite expects). postgres.js would
  // JSON.stringify json/jsonb parameters again and store a string instead of an object, so its
  // json serializers pass strings through untouched.
  const json = (oid: number) => ({ to: oid, from: [oid], serialize: (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)), parse: JSON.parse });
  // Supabase's transaction pooler (port 6543) doesn't support prepared statements.
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 30, types: { json: json(114), jsonb: json(3802) } as any });
  return {
    query: async (text, params = []) => (await sql.unsafe(text, params as any[])) as any,
    close: () => sql.end(),
  };
}

async function openPglite(path: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (path !== 'memory://') mkdirSync(path, { recursive: true });
  const db = new PGlite(path);
  for (const file of PORTABLE_SQL) await db.exec(readFileSync(join(SQL_DIR, file), 'utf8'));
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows as any,
    close: () => db.close(),
  };
}

export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** 6-digit code the parent reads out to pair a kid's phone. */
export const newPairingCode = () => String(100000 + (randomBytes(4).readUInt32BE() % 900000));
