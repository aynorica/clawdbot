import fs from "node:fs";
import path from "node:path";
import type { createMetadataStore, FileMetadata } from "../db/metadata-store.js";

export type MetadataStore = ReturnType<typeof createMetadataStore>;

const MIME_MAP: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".ts": "text/javascript",
  ".tsx": "text/javascript",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".csv": "text/csv",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".sh": "application/x-sh",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".rs": "text/x-rust",
  ".go": "text/x-go",
};

function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Walk `dirPath` recursively and upsert every non-hidden, non-ignored file
 * into the metadata store.
 */
export async function scanDirectory(
  dirPath: string,
  store: MetadataStore,
  onProgress?: (count: number) => void,
): Promise<void> {
  let count = 0;

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      // Directory may not be accessible — skip silently
      return;
    }

    for (const entry of entries) {
      // Skip hidden files and directories (dotfiles)
      if (entry.name.startsWith(".")) continue;
      // Skip node_modules
      if (entry.name === "node_modules") continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          const ext = path.extname(entry.name);
          const meta: FileMetadata = {
            path: fullPath,
            name: entry.name,
            directory: currentDir,
            extension: ext,
            mime_type: getMimeType(ext),
            size: stat.size,
            created_at: stat.birthtime.toISOString(),
            modified_at: stat.mtime.toISOString(),
            indexed_at: new Date().toISOString(),
          };
          store.upsert(meta);
          count++;
          if (onProgress && count % 100 === 0) {
            onProgress(count);
          }
        } catch {
          // File may have disappeared — skip
        }
      }
    }
  }

  walk(dirPath);

  // Final progress callback if not already called
  if (onProgress && count > 0) {
    onProgress(count);
  }
}
