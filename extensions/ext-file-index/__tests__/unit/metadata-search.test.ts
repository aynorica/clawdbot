import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initializeDatabase } from "../../src/db/schema.js";
import { createMetadataStore, type FileMetadata } from "../../src/db/metadata-store.js";
import { createMetadataSearch } from "../../src/search/metadata-search.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
type DB = InstanceType<typeof DatabaseSync>;

describe("MetadataSearch", () => {
  let db: DB;
  let store: ReturnType<typeof createMetadataStore>;
  let search: ReturnType<typeof createMetadataSearch>;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    initializeDatabase(db);
    store = createMetadataStore(db);
    search = createMetadataSearch(db);

    const files: FileMetadata[] = [
      {
        path: "/docs/report.pdf",
        name: "report.pdf",
        directory: "/docs",
        extension: ".pdf",
        mime_type: "application/pdf",
        size: 1000,
        created_at: "2024-01-01T00:00:00Z",
        modified_at: "2024-06-01T00:00:00Z",
        indexed_at: new Date().toISOString(),
      },
      {
        path: "/docs/notes.txt",
        name: "notes.txt",
        directory: "/docs",
        extension: ".txt",
        mime_type: "text/plain",
        size: 200,
        created_at: "2024-01-01T00:00:00Z",
        modified_at: "2024-05-01T00:00:00Z",
        indexed_at: new Date().toISOString(),
      },
      {
        path: "/code/main.ts",
        name: "main.ts",
        directory: "/code",
        extension: ".ts",
        mime_type: "text/javascript",
        size: 5000,
        created_at: "2024-01-01T00:00:00Z",
        modified_at: "2024-07-01T00:00:00Z",
        indexed_at: new Date().toISOString(),
      },
    ];
    files.forEach((f) => store.upsert(f));
  });

  afterEach(() => db.close());

  it("filters by extension", () => {
    const results = search.search({ extension: ".pdf" });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("report.pdf");
  });

  it("filters by directory", () => {
    const results = search.search({ directory: "/docs" });
    expect(results).toHaveLength(2);
  });

  it("filters by size", () => {
    const results = search.search({ minSize: 500 });
    expect(results.every((r) => r.size >= 500)).toBe(true);
  });
});
