import type { DatabaseSync } from "node:sqlite";

export function initializeDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA synchronous = NORMAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      correlation_id TEXT,
      plan_id TEXT,
      step_id INTEGER,
      action TEXT NOT NULL,
      node_id TEXT NOT NULL DEFAULT 'master',
      path TEXT,
      details TEXT,
      result TEXT NOT NULL,
      execution_mode TEXT,
      irreversible INTEGER DEFAULT 0,
      session_id TEXT,
      agent_id TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_log(correlation_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_plan ON audit_log(plan_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_node ON audit_log(node_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);`);
}
