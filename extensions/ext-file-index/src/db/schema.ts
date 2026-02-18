import type { DatabaseSync } from "node:sqlite";

/**
 * Initialize the file_metadata SQLite schema.
 * - WAL mode for concurrent reads
 * - busy_timeout=5000 to avoid SQLITE_BUSY errors
 * - FTS5 virtual table for full-text search on name + path + extension
 */
export function initializeDatabase(db: DatabaseSync): void {
  // Performance pragmas (node:sqlite uses exec for pragma)
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");

  // Core metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_metadata (
      path        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      directory   TEXT NOT NULL,
      extension   TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size        INTEGER NOT NULL,
      created_at  TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      indexed_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_file_metadata_directory   ON file_metadata (directory);
    CREATE INDEX IF NOT EXISTS idx_file_metadata_extension   ON file_metadata (extension);
    CREATE INDEX IF NOT EXISTS idx_file_metadata_modified_at ON file_metadata (modified_at);
    CREATE INDEX IF NOT EXISTS idx_file_metadata_name        ON file_metadata (name);

    CREATE VIRTUAL TABLE IF NOT EXISTS file_metadata_fts
      USING fts5(
        name,
        path,
        extension,
        content=file_metadata,
        content_rowid=rowid
      );

    -- Keep FTS in sync with the content table via triggers
    CREATE TRIGGER IF NOT EXISTS file_metadata_ai
      AFTER INSERT ON file_metadata BEGIN
        INSERT INTO file_metadata_fts (rowid, name, path, extension)
          VALUES (new.rowid, new.name, new.path, new.extension);
      END;

    CREATE TRIGGER IF NOT EXISTS file_metadata_ad
      AFTER DELETE ON file_metadata BEGIN
        INSERT INTO file_metadata_fts (file_metadata_fts, rowid, name, path, extension)
          VALUES ('delete', old.rowid, old.name, old.path, old.extension);
      END;

    CREATE TRIGGER IF NOT EXISTS file_metadata_au
      AFTER UPDATE ON file_metadata BEGIN
        INSERT INTO file_metadata_fts (file_metadata_fts, rowid, name, path, extension)
          VALUES ('delete', old.rowid, old.name, old.path, old.extension);
        INSERT INTO file_metadata_fts (rowid, name, path, extension)
          VALUES (new.rowid, new.name, new.path, new.extension);
      END;
  `);
}
