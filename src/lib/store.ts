// ─────────────────────────────────────────────────────────────────────────────
// Local-first task store — now PER-USER.
//
// Every task belongs to exactly one user. Reads/writes are scoped to the current
// user (from the request context, or DEFAULT_USER outside a request). The live
// in-process cache also records the owner, so a shared-process cache can never
// leak a task across accounts.
// ─────────────────────────────────────────────────────────────────────────────

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Task } from "./types";
import { currentUserId } from "./auth/context";

const DB_PATH = process.env.VOLO_DB_PATH || "./.data/volo.db";

let _db: Database.Database | null = null;

function ensureColumn(d: Database.Database, table: string, column: string, def: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

function db(): Database.Database {
  if (_db) return _db;
  const abs = path.resolve(process.cwd(), DB_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  _db = new Database(abs);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      data       TEXT NOT NULL
    );
  `);
  // Migrate existing single-user DBs: add user_id (existing rows → the local user).
  ensureColumn(_db, "tasks", "user_id", "TEXT NOT NULL DEFAULT 'local'");
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, updated_at)`);
  return _db;
}

// Live in-memory copies (shared object identity within the process) + their owner.
const live = new Map<string, Task>();
const owner = new Map<string, string>();

export function saveTask(task: Task): void {
  const uid = currentUserId();
  task.updatedAt = Date.now();
  live.set(task.id, task);
  owner.set(task.id, uid);
  db()
    .prepare(
      `INSERT INTO tasks (id, user_id, created_at, updated_at, data)
       VALUES (@id, @uid, @createdAt, @updatedAt, @data)
       ON CONFLICT(id) DO UPDATE SET updated_at = @updatedAt, data = @data`
    )
    .run({ id: task.id, uid, createdAt: task.createdAt, updatedAt: task.updatedAt, data: JSON.stringify(task) });
}

export function getTask(taskId: string): Task | null {
  const uid = currentUserId();
  if (live.has(taskId) && owner.get(taskId) === uid) return live.get(taskId)!;
  const row = db().prepare(`SELECT data FROM tasks WHERE id = ? AND user_id = ?`).get(taskId, uid) as { data: string } | undefined;
  if (!row) return null;
  const task = JSON.parse(row.data) as Task;
  live.set(task.id, task);
  owner.set(task.id, uid);
  return task;
}

export function listTasks(limit = 50): Task[] {
  const uid = currentUserId();
  const rows = db().prepare(`SELECT data FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`).all(uid, limit) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Task);
}

export function deleteTask(taskId: string): void {
  const uid = currentUserId();
  live.delete(taskId);
  owner.delete(taskId);
  db().prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`).run(taskId, uid);
}
