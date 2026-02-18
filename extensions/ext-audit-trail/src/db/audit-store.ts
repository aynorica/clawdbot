import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type AuditEntry = {
  timestamp?: string;
  correlation_id?: string;
  plan_id?: string;
  step_id?: number;
  action: string;
  node_id?: string;
  path?: string;
  details?: Record<string, unknown>;
  result: "success" | "error" | "blocked" | "timeout";
  execution_mode?: string;
  irreversible?: boolean;
  session_id?: string;
  agent_id?: string;
};

export type AuditQuery = {
  startTime?: string;
  endTime?: string;
  nodeId?: string;
  action?: string;
  correlationId?: string;
  planId?: string;
  result?: string;
  limit?: number;
  offset?: number;
};

export function createAuditStore(db: DatabaseSync) {
  // IMPORTANT: This module NEVER issues UPDATE or DELETE on audit_log

  function append(entry: AuditEntry): void {
    db.prepare(`
      INSERT INTO audit_log
        (timestamp, correlation_id, plan_id, step_id, action, node_id, path, details, result, execution_mode, irreversible, session_id, agent_id)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.timestamp ?? new Date().toISOString(),
      entry.correlation_id ?? null,
      entry.plan_id ?? null,
      entry.step_id ?? null,
      entry.action,
      entry.node_id ?? "master",
      entry.path ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.result,
      entry.execution_mode ?? null,
      entry.irreversible ? 1 : 0,
      entry.session_id ?? null,
      entry.agent_id ?? null,
    );
  }

  function query(filter: AuditQuery = {}): AuditEntry[] {
    const conditions: string[] = [];
    const positionalParams: SQLInputValue[] = [];

    if (filter.startTime) {
      conditions.push("timestamp >= ?");
      positionalParams.push(filter.startTime);
    }
    if (filter.endTime) {
      conditions.push("timestamp <= ?");
      positionalParams.push(filter.endTime);
    }
    if (filter.nodeId) {
      conditions.push("node_id = ?");
      positionalParams.push(filter.nodeId);
    }
    if (filter.action) {
      conditions.push("action = ?");
      positionalParams.push(filter.action);
    }
    if (filter.correlationId) {
      conditions.push("correlation_id = ?");
      positionalParams.push(filter.correlationId);
    }
    if (filter.planId) {
      conditions.push("plan_id = ?");
      positionalParams.push(filter.planId);
    }
    if (filter.result) {
      conditions.push("result = ?");
      positionalParams.push(filter.result);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    positionalParams.push(limit, offset);

    const rows = db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...positionalParams) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      ...row,
      details: row.details
        ? (JSON.parse(row.details as string) as Record<string, unknown>)
        : undefined,
      irreversible: row.irreversible === 1,
    })) as AuditEntry[];
  }

  function getCount(filter: AuditQuery = {}): number {
    const conditions: string[] = [];
    const positionalParams: SQLInputValue[] = [];

    if (filter.startTime) {
      conditions.push("timestamp >= ?");
      positionalParams.push(filter.startTime);
    }
    if (filter.endTime) {
      conditions.push("timestamp <= ?");
      positionalParams.push(filter.endTime);
    }
    if (filter.nodeId) {
      conditions.push("node_id = ?");
      positionalParams.push(filter.nodeId);
    }
    if (filter.action) {
      conditions.push("action = ?");
      positionalParams.push(filter.action);
    }
    if (filter.result) {
      conditions.push("result = ?");
      positionalParams.push(filter.result);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`)
      .get(...positionalParams) as { count: number };
    return row.count;
  }

  return { append, query, getCount };
}

export type AuditStore = ReturnType<typeof createAuditStore>;
