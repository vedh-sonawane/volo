// ─────────────────────────────────────────────────────────────────────────────
// Local-first task store.
//
// Persists tasks to a local SQLite file (zero cost, no server). The whole Task
// object is stored as JSON in a single column — the engine treats a task as an
// aggregate and we never need to query into its internals. An in-process cache
// keeps the "live" task object identical between the running engine and any
// reader, so SSE streaming reflects real state.
// ─────────────────────────────────────────────────────────────────────────────

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Task } from "./types";

const DB_PATH = process.env.VOLO_DB_PATH || "./.data/volo.db";

let _db: Database.Database | null = null;

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
  return _db;
}

// Live in-memory copies so a running engine and concurrent readers share one
// object identity within the process.
const live = new Map<string, Task>();

export function saveTask(task: Task): void {
  task.updatedAt = Date.now();
  live.set(task.id, task);
  db()
    .prepare(
      `INSERT INTO tasks (id, created_at, updated_at, data)
       VALUES (@id, @createdAt, @updatedAt, @data)
       ON CONFLICT(id) DO UPDATE SET updated_at = @updatedAt, data = @data`
    )
    .run({
      id: task.id,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      data: JSON.stringify(task),
    });
}

export function getTask(taskId: string): Task | null {
  if (live.has(taskId)) return live.get(taskId)!;
  const row = db().prepare(`SELECT data FROM tasks WHERE id = ?`).get(taskId) as
    | { data: string }
    | undefined;
  if (!row) return null;
  const task = JSON.parse(row.data) as Task;
  live.set(task.id, task);
  return task;
}

export function listTasks(limit = 50): Task[] {
  const rows = db()
    .prepare(`SELECT data FROM tasks ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Task);
}

export function deleteTask(taskId: string): void {
  live.delete(taskId);
  db().prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
}
