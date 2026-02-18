import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initializeDatabase } from "../../src/db/schema.js";
import { createMetadataStore, type FileMetadata } from "../../src/db/metadata-store.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
type DB = InstanceType<typeof DatabaseSync>;

const sample: FileMetadata = {
  path: "/home/user/docs/report.pdf",
  name: "report.pdf",
  directory: "/home/user/docs",
  extension: ".pdf",
  mime_type: "application/pdf",
  size: 102400,
  created_at: "2024-01-01T00:00:00.000Z",
  modified_at: "2024-06-01T00:00:00.000Z",
  indexed_at: new Date().toISOString(),
};

describe("MetadataStore", () => {
  let db: DB;
  let store: ReturnType<typeof createMetadataStore>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initializeDatabase(db);
    store = createMetadataStore(db);
  });

  afterEach(() => db.close());

  it("upserts and retrieves a file", () => {
    store.upsert(sample);
    const result = store.getByPath(sample.path);
    expect(result).toBeDefined();
    expect(result!.name).toBe("report.pdf");
    expect(result!.size).toBe(102400);
  });

  it("removes a file", () => {
    store.upsert(sample);
    store.remove(sample.path);
    expect(store.getByPath(sample.path)).toBeUndefined();
  });

  it("lists directory contents", () => {
    store.upsert(sample);
    store.upsert({
      ...sample,
      path: "/home/user/docs/notes.txt",
      name: "notes.txt",
      extension: ".txt",
      mime_type: "text/plain",
    });
    const files = store.listDirectory("/home/user/docs");
    expect(files).toHaveLength(2);
  });

  it("removes all files in a directory", () => {
    store.upsert(sample);
    store.removeByDirectory("/home/user/docs");
    expect(store.listDirectory("/home/user/docs")).toHaveLength(0);
  });

  it("returns accurate stats", () => {
    store.upsert(sample);
    const stats = store.getStats();
    expect(stats.totalFiles).toBe(1);
    expect(stats.totalSize).toBe(102400);
  });
});
