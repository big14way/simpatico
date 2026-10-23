import { mkdirSync } from 'node:fs';
import { SCHEMA } from './schema';

export interface Db {
  readonly kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** run several statements (no params) */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function postgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  // timestamptz -> Date and jsonb -> object are pg defaults; keep int8 as string-safe number
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  return {
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

async function pglite(dataDir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await db.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

export interface OpenOptions {
  /** Postgres URL; when empty, an embedded PGlite database is used */
  databaseUrl?: string | null;
  /** PGlite data directory; null = in-memory (tests) */
  dataDir?: string | null;
}

export async function openDb(opts: OpenOptions = {}): Promise<Db> {
  const db = opts.databaseUrl ? await postgres(opts.databaseUrl) : await pglite(opts.dataDir === undefined ? '.data/pglite' : opts.dataDir);
  await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA);
}

const g = globalThis as unknown as { __simpaticoDb?: Promise<Db> };

/** Process-wide database (survives Next.js dev reloads). */
export function getDb(): Promise<Db> {
  if (!g.__simpaticoDb) {
    g.__simpaticoDb = openDb({
      databaseUrl: process.env.DATABASE_URL || null,
      dataDir: process.env.PGLITE_DIR || '.data/pglite',
    }).catch((err) => {
      g.__simpaticoDb = undefined;
      throw err;
    });
  }
  return g.__simpaticoDb;
}

/** jsonb parameters must be passed as JSON text (pg would turn JS arrays into Postgres arrays). */
export function j(value: unknown): string {
  return JSON.stringify(value ?? null);
}
