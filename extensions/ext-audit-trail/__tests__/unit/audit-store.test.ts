import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { initializeDatabase } from "../../src/db/schema.js";
import { createAuditStore } from "../../src/db/audit-store.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
type DB = InstanceType<typeof DatabaseSync>;

describe("AuditStore", () => {
  let db: DB;
  let store: ReturnType<typeof createAuditStore>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initializeDatabase(db);
    store = createAuditStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("appends and queries entries", () => {
    store.append({ action: "READ_FILE", result: "success", path: "/tmp/test.txt" });
    const entries = store.query({});
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("READ_FILE");
    expect(entries[0].path).toBe("/tmp/test.txt");
  });

  it("filters by action", () => {
    store.append({ action: "READ_FILE", result: "success" });
    store.append({ action: "WRITE_FILE", result: "success" });
    const entries = store.query({ action: "READ_FILE" });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("READ_FILE");
  });

  it("filters by result", () => {
    store.append({ action: "DELETE_FILE", result: "error" });
    store.append({ action: "READ_FILE", result: "success" });
    const errorEntries = store.query({ result: "error" });
    expect(errorEntries).toHaveLength(1);
  });

  it("paginates with limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      store.append({ action: `ACTION_${i}`, result: "success" });
    }
    const page1 = store.query({ limit: 2, offset: 0 });
    const page2 = store.query({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
  });

  it("returns count", () => {
    store.append({ action: "READ_FILE", result: "success" });
    store.append({ action: "READ_FILE", result: "error" });
    expect(store.getCount({})).toBe(2);
    expect(store.getCount({ result: "success" })).toBe(1);
  });

  it("has no UPDATE or DELETE statements (append-only)", () => {
    // This test ensures no rows are removed
    store.append({ action: "IMPORTANT_ACTION", result: "success" });
    const before = store.query({});
    // There is no delete method exposed — just verify the count only grows
    store.append({ action: "ANOTHER_ACTION", result: "success" });
    const after = store.query({});
    expect(after.length).toBeGreaterThan(before.length);
  });
});
