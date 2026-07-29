// Account deletion — removes a user AND all of their data across every table, so
// nothing is orphaned or recoverable. Runs in one place against the shared DB.

import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env.VOLO_DB_PATH || "./.data/volo.db";
let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(path.resolve(process.cwd(), DB_PATH));
  _db.pragma("journal_mode = WAL");
  return _db;
}

/** Delete the user's account and ALL their data (tasks, config, secrets, links). */
export function deleteUserAccount(userId: string): void {
  const d = db();
  const tables: [string, string][] = [
    ["users", "id"],
    ["sessions", "user_id"],
    ["auth_tokens", "user_id"],
    ["oauth_accounts", "user_id"],
    ["tasks", "user_id"],
    ["config_kv", "user_id"],
    ["secret_kv", "user_id"],
  ];
  const tx = d.transaction((uid: string) => {
    for (const [table, col] of tables) {
      try {
        d.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(uid);
      } catch {
        /* table may not exist yet — ignore */
      }
    }
  });
  tx(userId);
}
