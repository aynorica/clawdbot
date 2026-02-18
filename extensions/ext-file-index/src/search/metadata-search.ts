import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { FileMetadata } from "../db/metadata-store.js";

export type MetadataSearchQuery = {
  text?: string;
  extension?: string;
  directory?: string;
  minSize?: number;
  maxSize?: number;
  modifiedAfter?: string;
  modifiedBefore?: string;
  limit?: number;
  offset?: number;
};

export function createMetadataSearch(db: DatabaseSync) {
  return {
    search(query: MetadataSearchQuery): FileMetadata[] {
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;

      if (query.text) {
        // FTS5 search path: join against the virtual table
        const conditions: string[] = ["file_metadata_fts MATCH ?"];
        const params: SQLInputValue[] = [query.text];

        if (query.extension !== undefined) {
          conditions.push("fm.extension = ?");
          params.push(query.extension);
        }
        if (query.directory !== undefined) {
          conditions.push("(fm.directory = ? OR fm.directory LIKE ?)");
          const like = query.directory.endsWith("/")
            ? `${query.directory}%`
            : `${query.directory}/%`;
          params.push(query.directory, like);
        }
        if (query.minSize !== undefined) {
          conditions.push("fm.size >= ?");
          params.push(query.minSize);
        }
        if (query.maxSize !== undefined) {
          conditions.push("fm.size <= ?");
          params.push(query.maxSize);
        }
        if (query.modifiedAfter !== undefined) {
          conditions.push("fm.modified_at >= ?");
          params.push(query.modifiedAfter);
        }
        if (query.modifiedBefore !== undefined) {
          conditions.push("fm.modified_at <= ?");
          params.push(query.modifiedBefore);
        }

        params.push(limit, offset);

        const sql = `
          SELECT fm.*
          FROM file_metadata fm
          JOIN file_metadata_fts fts ON fm.rowid = fts.rowid
          WHERE ${conditions.join(" AND ")}
          LIMIT ? OFFSET ?
        `;

        return db.prepare(sql).all(...params) as FileMetadata[];
      }

      // Non-FTS path: plain SELECT with WHERE clauses
      const conditions: string[] = [];
      const params: SQLInputValue[] = [];

      if (query.extension !== undefined) {
        conditions.push("extension = ?");
        params.push(query.extension);
      }
      if (query.directory !== undefined) {
        conditions.push("(directory = ? OR directory LIKE ?)");
        const like = query.directory.endsWith("/")
          ? `${query.directory}%`
          : `${query.directory}/%`;
        params.push(query.directory, like);
      }
      if (query.minSize !== undefined) {
        conditions.push("size >= ?");
        params.push(query.minSize);
      }
      if (query.maxSize !== undefined) {
        conditions.push("size <= ?");
        params.push(query.maxSize);
      }
      if (query.modifiedAfter !== undefined) {
        conditions.push("modified_at >= ?");
        params.push(query.modifiedAfter);
      }
      if (query.modifiedBefore !== undefined) {
        conditions.push("modified_at <= ?");
        params.push(query.modifiedBefore);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit, offset);

      const sql = `SELECT * FROM file_metadata ${where} ORDER BY modified_at DESC LIMIT ? OFFSET ?`;
      return db.prepare(sql).all(...params) as FileMetadata[];
    },
  };
}
