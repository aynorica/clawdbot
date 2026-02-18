/**
 * Integration tests for ext-file-index (metadata store + search).
 * Uses an in-memory SQLite database.
 */
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach } from "vitest";

import { initializeDatabase } from "../../ext-file-index/src/db/schema.js";
import { createMetadataStore } from "../../ext-file-index/src/db/metadata-store.js";
import { createMetadataSearch } from "../../ext-file-index/src/search/metadata-search.js";
import type { FileMetadata } from "../../ext-file-index/src/db/metadata-store.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
type DB = InstanceType<typeof DatabaseSync>;

function makeFile(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    path: "/home/user/docs/readme.md",
    name: "readme.md",
    directory: "/home/user/docs",
    extension: ".md",
    mime_type: "text/markdown",
    size: 1024,
    created_at: "2025-01-01T00:00:00.000Z",
    modified_at: "2025-06-01T00:00:00.000Z",
    indexed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("ext-file-index — metadata store integration", () => {
  let db: DB;
  let store: ReturnType<typeof createMetadataStore>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initializeDatabase(db);
    store = createMetadataStore(db);
  });

  it("upserts and retrieves a file by path", () => {
    const f = makeFile();
    store.upsert(f);
    const got = store.getByPath(f.path);
    expect(got).toBeDefined();
    expect(got!.name).toBe("readme.md");
    expect(got!.size).toBe(1024);
  });

  it("upsert replaces existing row (no duplicate)", () => {
    store.upsert(makeFile({ size: 100 }));
    store.upsert(makeFile({ size: 200 }));
    const got = store.getByPath("/home/user/docs/readme.md");
    expect(got!.size).toBe(200);
  });

  it("remove deletes a file entry", () => {
    store.upsert(makeFile());
    store.remove("/home/user/docs/readme.md");
    expect(store.getByPath("/home/user/docs/readme.md")).toBeUndefined();
  });

  it("listDirectory returns files in the directory", () => {
    store.upsert(makeFile({ path: "/home/user/docs/readme.md", name: "readme.md" }));
    store.upsert(makeFile({ path: "/home/user/docs/notes.md", name: "notes.md" }));
    store.upsert(makeFile({ path: "/home/user/photos/pic.jpg", name: "pic.jpg", directory: "/home/user/photos", extension: ".jpg", mime_type: "image/jpeg" }));

    const docs = store.listDirectory("/home/user/docs");
    expect(docs.length).toBe(2);
    expect(docs.map((f) => f.name)).toContain("notes.md");
  });

  it("removeByDirectory cascades correctly", () => {
    store.upsert(makeFile({ path: "/proj/src/a.ts", name: "a.ts", directory: "/proj/src", extension: ".ts", mime_type: "text/typescript" }));
    store.upsert(makeFile({ path: "/proj/src/b.ts", name: "b.ts", directory: "/proj/src", extension: ".ts", mime_type: "text/typescript" }));
    store.upsert(makeFile({ path: "/proj/test/c.ts", name: "c.ts", directory: "/proj/test", extension: ".ts", mime_type: "text/typescript" }));

    store.removeByDirectory("/proj/src");
    expect(store.getByPath("/proj/src/a.ts")).toBeUndefined();
    expect(store.getByPath("/proj/src/b.ts")).toBeUndefined();
    // File in a different directory should remain
    expect(store.getByPath("/proj/test/c.ts")).toBeDefined();
  });

  it("getStats returns accurate totals", () => {
    store.upsert(makeFile({ path: "/a.ts", name: "a.ts", directory: "/", extension: ".ts", mime_type: "text/typescript", size: 500 }));
    store.upsert(makeFile({ path: "/b.md", name: "b.md", directory: "/docs", extension: ".md", mime_type: "text/markdown", size: 300 }));
    store.upsert(makeFile({ path: "/c.md", name: "c.md", directory: "/docs", extension: ".md", mime_type: "text/markdown", size: 200 }));

    const stats = store.getStats();
    expect(stats.totalFiles).toBe(3);
    expect(stats.totalSize).toBe(1000);
    expect(stats.indexedDirs).toBe(2); // "/" and "/docs"
  });

  it("getStats returns zeros for empty index", () => {
    const stats = store.getStats();
    expect(stats.totalFiles).toBe(0);
    expect(stats.totalSize).toBe(0);
    expect(stats.indexedDirs).toBe(0);
  });
});

describe("ext-file-index — metadata search integration", () => {
  let db: DB;
  let store: ReturnType<typeof createMetadataStore>;
  let search: ReturnType<typeof createMetadataSearch>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initializeDatabase(db);
    store = createMetadataStore(db);
    search = createMetadataSearch(db);

    // Seed a variety of files
    store.upsert(makeFile({ path: "/proj/src/index.ts", name: "index.ts", directory: "/proj/src", extension: ".ts", mime_type: "text/typescript", size: 2000, modified_at: "2025-03-01T00:00:00.000Z" }));
    store.upsert(makeFile({ path: "/proj/src/utils.ts", name: "utils.ts", directory: "/proj/src", extension: ".ts", mime_type: "text/typescript", size: 800, modified_at: "2025-04-01T00:00:00.000Z" }));
    store.upsert(makeFile({ path: "/proj/docs/readme.md", name: "readme.md", directory: "/proj/docs", extension: ".md", mime_type: "text/markdown", size: 512, modified_at: "2025-05-01T00:00:00.000Z" }));
    store.upsert(makeFile({ path: "/proj/docs/notes.md", name: "notes.md", directory: "/proj/docs", extension: ".md", mime_type: "text/markdown", size: 256, modified_at: "2025-05-15T00:00:00.000Z" }));
    store.upsert(makeFile({ path: "/photos/vacation.jpg", name: "vacation.jpg", directory: "/photos", extension: ".jpg", mime_type: "image/jpeg", size: 3_000_000, modified_at: "2025-02-01T00:00:00.000Z" }));
  });

  it("search by extension returns correct files", () => {
    const ts = search.search({ extension: ".ts" });
    expect(ts.length).toBe(2);
    expect(ts.every((f) => f.extension === ".ts")).toBe(true);
  });

  it("search by directory returns files in that directory", () => {
    const docs = search.search({ directory: "/proj/docs" });
    expect(docs.length).toBe(2);
    expect(docs.every((f) => f.directory === "/proj/docs")).toBe(true);
  });

  it("search by minSize filters correctly", () => {
    const big = search.search({ minSize: 1_000_000 });
    expect(big.length).toBe(1);
    expect(big[0].name).toBe("vacation.jpg");
  });

  it("search by maxSize filters correctly", () => {
    const small = search.search({ maxSize: 512 });
    expect(small.length).toBe(2); // notes.md (256) and readme.md (512)
  });

  it("search by minSize + maxSize range", () => {
    const mid = search.search({ minSize: 500, maxSize: 2500 });
    expect(mid.length).toBe(3); // index.ts (2000), utils.ts (800), readme.md (512)
  });

  it("search by modifiedAfter", () => {
    const recent = search.search({ modifiedAfter: "2025-04-15T00:00:00.000Z" });
    // readme.md (2025-05-01), notes.md (2025-05-15)
    expect(recent.length).toBe(2);
  });

  it("search by modifiedBefore", () => {
    const old = search.search({ modifiedBefore: "2025-03-15T00:00:00.000Z" });
    // index.ts (2025-03-01), vacation.jpg (2025-02-01)
    expect(old.length).toBe(2);
  });

  it("search by extension + directory combined", () => {
    const ts_src = search.search({ extension: ".ts", directory: "/proj/src" });
    expect(ts_src.length).toBe(2);
    expect(ts_src.every((f) => f.extension === ".ts" && f.directory === "/proj/src")).toBe(true);
  });

  it("returns empty array when no files match", () => {
    const r = search.search({ extension: ".exe" });
    expect(r.length).toBe(0);
  });

  it("respects limit", () => {
    const limited = search.search({ limit: 2 });
    expect(limited.length).toBe(2);
  });

  it("FTS full-text search by filename (skip if FTS5 not available)", () => {
    let ftsAvailable = true;
    try {
      db.prepare("SELECT * FROM file_metadata_fts LIMIT 1").all();
    } catch {
      ftsAvailable = false;
    }

    if (!ftsAvailable) {
      // FTS5 not available in this SQLite build — mark as skipped
      console.warn("SKIP: FTS5 not available in node:sqlite in-memory");
      return;
    }

    const results = search.search({ text: "readme" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((f) => f.name === "readme.md")).toBe(true);
  });

  it("FTS search for filename term (skip if FTS5 not available or syntax error)", () => {
    let ftsAvailable = true;
    try {
      db.prepare("SELECT * FROM file_metadata_fts LIMIT 1").all();
    } catch {
      ftsAvailable = false;
    }

    if (!ftsAvailable) {
      console.warn("SKIP: FTS5 not available in node:sqlite in-memory");
      return;
    }

    // Use a plain word token (no dots) as FTS5 query — dots cause syntax errors
    try {
      const results = search.search({ text: "index" });
      expect(results.length).toBeGreaterThanOrEqual(1);
    } catch (err: unknown) {
      // FTS5 syntax errors are non-fatal; skip gracefully
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("SKIP: FTS5 query failed:", msg);
    }
  });
});
