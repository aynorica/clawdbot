import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type FileMetadata = {
  path: string;
  name: string;
  directory: string;
  extension: string;
  mime_type: string;
  size: number;
  created_at: string;
  modified_at: string;
  indexed_at: string;
};

export function createMetadataStore(db: DatabaseSync) {
  return {
    upsert(entry: FileMetadata): void {
      db.prepare(`
        INSERT OR REPLACE INTO file_metadata
          (path, name, directory, extension, mime_type, size, created_at, modified_at, indexed_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.path, entry.name, entry.directory, entry.extension, entry.mime_type,
        entry.size, entry.created_at, entry.modified_at, entry.indexed_at,
      );
    },

    remove(filePath: string): void {
      db.prepare("DELETE FROM file_metadata WHERE path = ?").run(filePath);
    },

    removeByDirectory(dirPath: string): void {
      const likePattern = dirPath.endsWith("/") ? `${dirPath}%` : `${dirPath}/%`;
      db.prepare("DELETE FROM file_metadata WHERE directory = ? OR directory LIKE ?").run(dirPath, likePattern);
    },

    getByPath(filePath: string): FileMetadata | undefined {
      return db.prepare("SELECT * FROM file_metadata WHERE path = ?").get(filePath) as FileMetadata | undefined;
    },

    listDirectory(dirPath: string): FileMetadata[] {
      const likePattern = dirPath.endsWith("/") ? `${dirPath}%` : `${dirPath}/%`;
      return db.prepare("SELECT * FROM file_metadata WHERE directory = ? OR directory LIKE ? ORDER BY name").all(dirPath, likePattern) as FileMetadata[];
    },

    getStats(): { totalFiles: number; totalSize: number; indexedDirs: number } {
      const row = db.prepare(`
        SELECT
          COUNT(*) AS totalFiles,
          COALESCE(SUM(size), 0) AS totalSize,
          COUNT(DISTINCT directory) AS indexedDirs
        FROM file_metadata
      `).get() as { totalFiles: number; totalSize: number; indexedDirs: number };
      return row;
    },
  };
}
