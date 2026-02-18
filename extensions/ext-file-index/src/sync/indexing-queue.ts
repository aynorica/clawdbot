import fs from "node:fs";
import path from "node:path";
import type { FileMetadata } from "../db/metadata-store.js";
import type { createMetadataStore } from "../db/metadata-store.js";

type MetadataStore = ReturnType<typeof createMetadataStore>;

// Map file extensions to MIME types
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
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".csv": "text/csv",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".sh": "application/x-sh",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".rs": "text/x-rust",
  ".go": "text/x-go",
};

function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

function buildMetadata(filePath: string, stat: fs.Stats): FileMetadata {
  const name = path.basename(filePath);
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  return {
    path: filePath,
    name,
    directory,
    extension,
    mime_type: getMimeType(extension),
    size: stat.size,
    created_at: stat.birthtime.toISOString(),
    modified_at: stat.mtime.toISOString(),
    indexed_at: new Date().toISOString(),
  };
}

type QueueEntry = { operation: "add" | "change" | "unlink"; filePath: string };

export function createIndexingQueue(store: MetadataStore) {
  const pending = new Map<string, "add" | "change" | "unlink">();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function processOne(filePath: string, operation: "add" | "change" | "unlink"): void {
    if (operation === "unlink") {
      store.remove(filePath);
      return;
    }
    // add / change — stat, then upsert
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return;
      const meta = buildMetadata(filePath, stat);
      store.upsert(meta);
    } catch (err) {
      // File may have disappeared between the event and the stat — safe to ignore
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[ext-file-index] Failed to stat ${filePath}:`, err);
      }
    }
  }

  function processBatch(): void {
    timer = null;
    const entries: QueueEntry[] = [];
    for (const [filePath, operation] of pending) {
      entries.push({ filePath, operation });
    }
    pending.clear();

    for (const { filePath, operation } of entries) {
      try {
        processOne(filePath, operation);
      } catch (err) {
        console.warn(`[ext-file-index] Error processing ${filePath}:`, err);
      }
    }
  }

  function scheduleFlush(): void {
    if (stopped) return;
    if (timer !== null) return;
    timer = setTimeout(() => {
      processBatch();
    }, 200);
  }

  return {
    enqueue(operation: "add" | "change" | "unlink", filePath: string): void {
      if (stopped) return;
      // Later operation wins — unlink overrides add/change for the same path
      const existing = pending.get(filePath);
      if (operation === "unlink" || !existing) {
        pending.set(filePath, operation);
      }
      scheduleFlush();
    },

    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
      }
      processBatch();
    },

    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
    },
  };
}
