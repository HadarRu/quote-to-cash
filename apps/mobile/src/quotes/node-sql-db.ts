// Tests only (Node): never imported by the app.
import { DatabaseSync } from 'node:sqlite';
import type { SqlDb } from './store.ts';

/** expo-sqlite's async API over Node's built-in SQLite, on a real database file. */
export function nodeSqlDb(file: string): SqlDb & { close(): void } {
  const db = new DatabaseSync(file);
  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, params) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllAsync: async <T>(sql: string, params: (string | number | null)[]) =>
      db.prepare(sql).all(...params) as T[],
    getFirstAsync: async <T>(sql: string, params: (string | number | null)[]) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    close: () => db.close(),
  };
}
