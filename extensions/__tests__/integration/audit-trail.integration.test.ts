/**
 * Integration tests for ext-audit-trail.
 * Uses an in-memory SQLite database to verify the full audit store lifecycle.
 */
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach } from "vitest";

import { initializeDatabase } from "../../ext-audit-trail/src/db/schema.js";
import { createAuditStore } from "../../ext-audit-trail/src/db/audit-store.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
type DB = InstanceType<typeof DatabaseSync>;

describe("ext-audit-trail — integration", () => {
  let db: DB;
  let store: ReturnType<typeof createAuditStore>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initializeDatabase(db);
    store = createAuditStore(db);
  });

  it("appends entries and queries them back", () => {
    store.append({ action: "file.read", result: "success", path: "/tmp/a.txt" });
    store.append({ action: "file.write", result: "success", path: "/tmp/b.txt" });

    const all = store.query({});
    expect(all.length).toBe(2);
    const actions = all.map((e) => e.action);
    expect(actions).toContain("file.read");
    expect(actions).toContain("file.write");
  });

  it("filters by action", () => {
    store.append({ action: "file.read", result: "success" });
    store.append({ action: "gateway.method", result: "success" });
    store.append({ action: "file.read", result: "error" });

    const reads = store.query({ action: "file.read" });
    expect(reads.length).toBe(2);
    expect(reads.every((e) => e.action === "file.read")).toBe(true);
  });

  it("filters by result", () => {
    store.append({ action: "file.read", result: "success" });
    store.append({ action: "file.write", result: "error" });
    store.append({ action: "file.delete", result: "blocked" });

    const errors = store.query({ result: "error" });
    expect(errors.length).toBe(1);
    expect(errors[0].result).toBe("error");

    const blocked = store.query({ result: "blocked" });
    expect(blocked.length).toBe(1);
  });

  it("filters by nodeId", () => {
    store.append({ action: "file.read", result: "success", node_id: "pi-node" });
    store.append({ action: "file.read", result: "success", node_id: "master" });

    const pi = store.query({ nodeId: "pi-node" });
    expect(pi.length).toBe(1);
    expect(pi[0].node_id).toBe("pi-node");
  });

  it("filters by correlationId", () => {
    store.append({ action: "file.read", result: "success", correlation_id: "corr-abc" });
    store.append({ action: "file.write", result: "success", correlation_id: "corr-xyz" });

    const r = store.query({ correlationId: "corr-abc" });
    expect(r.length).toBe(1);
    expect(r[0].correlation_id).toBe("corr-abc");
  });

  it("filters by planId", () => {
    store.append({ action: "file.move", result: "success", plan_id: "plan-1" });
    store.append({ action: "file.delete", result: "success", plan_id: "plan-2" });

    const r = store.query({ planId: "plan-1" });
    expect(r.length).toBe(1);
    expect(r[0].plan_id).toBe("plan-1");
  });

  it("filters by time range", () => {
    const t1 = "2025-01-01T00:00:00.000Z";
    const t2 = "2025-06-01T00:00:00.000Z";
    const t3 = "2025-12-31T00:00:00.000Z";

    store.append({ action: "a", result: "success", timestamp: t1 });
    store.append({ action: "b", result: "success", timestamp: t2 });
    store.append({ action: "c", result: "success", timestamp: t3 });

    const mid = store.query({ startTime: "2025-03-01T00:00:00.000Z", endTime: "2025-09-01T00:00:00.000Z" });
    expect(mid.length).toBe(1);
    expect(mid[0].action).toBe("b");
  });

  it("respects limit and offset", () => {
    for (let i = 0; i < 10; i++) {
      store.append({ action: `op-${i}`, result: "success" });
    }
    const page1 = store.query({ limit: 3, offset: 0 });
    expect(page1.length).toBe(3);

    const page2 = store.query({ limit: 3, offset: 3 });
    expect(page2.length).toBe(3);

    // No overlap between pages
    const ids1 = page1.map((e) => e.action);
    const ids2 = page2.map((e) => e.action);
    expect(ids1.some((a) => ids2.includes(a))).toBe(false);
  });

  it("getCount returns accurate counts", () => {
    store.append({ action: "file.read", result: "success" });
    store.append({ action: "file.read", result: "error" });
    store.append({ action: "file.write", result: "success" });

    expect(store.getCount({})).toBe(3);
    expect(store.getCount({ action: "file.read" })).toBe(2);
    expect(store.getCount({ result: "success" })).toBe(2);
    expect(store.getCount({ result: "error" })).toBe(1);
  });

  it("stores and round-trips details JSON", () => {
    store.append({
      action: "file.write",
      result: "success",
      details: { bytes: 1234, encoding: "utf-8" },
    });

    const entries = store.query({ action: "file.write" });
    expect(entries.length).toBe(1);
    expect(entries[0].details).toEqual({ bytes: 1234, encoding: "utf-8" });
  });

  it("stores irreversible flag correctly", () => {
    store.append({ action: "file.delete", result: "success", irreversible: true });
    store.append({ action: "file.read", result: "success", irreversible: false });

    const del = store.query({ action: "file.delete" });
    expect(del[0].irreversible).toBe(true);

    const read = store.query({ action: "file.read" });
    expect(read[0].irreversible).toBe(false);
  });

  it("audit log is append-only — createAuditStore exposes no update/delete methods", () => {
    const exposed = Object.keys(store);
    // Only append, query, getCount are allowed; no update, delete, patch, remove
    for (const name of exposed) {
      expect(["append", "query", "getCount"]).toContain(name);
    }
    // Direct SQL verification: ensure no UPDATE/DELETE in schema or store source
    // (We verify by checking the DB still has all rows after queries)
    store.append({ action: "x", result: "success" });
    store.append({ action: "y", result: "success" });
    store.query({}); // must not mutate
    expect(store.getCount({})).toBe(2);
  });

  it("defaults node_id to 'master' when not provided", () => {
    store.append({ action: "file.read", result: "success" });
    const entries = store.query({});
    expect(entries[0].node_id).toBe("master");
  });

  it("gateway method entries are logged correctly", () => {
    store.append({
      action: "gateway.addWhitelistDirectory",
      result: "success",
      node_id: "master",
      details: { directory: "/home/user/docs" },
      session_id: "sess-1",
      agent_id: "agent-007",
    });

    const entries = store.query({ action: "gateway.addWhitelistDirectory" });
    expect(entries.length).toBe(1);
    expect(entries[0].details).toEqual({ directory: "/home/user/docs" });
    expect(entries[0].session_id).toBe("sess-1");
    expect(entries[0].agent_id).toBe("agent-007");
  });
});
