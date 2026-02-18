import fs from "node:fs";
import path from "node:path";
import {
  canonicalizePath,
  validateReadAccess,
  type WhitelistEntry,
} from "../security/path-validator.js";
import type {
  FileListInput,
  FileListOutput,
  FileListEntry,
  FileReadInput,
  FileReadOutput,
  FileStatInput,
  FileStatOutput,
  FileSearchKeywordInput,
  FileSearchKeywordOutput,
  FileCommandResult,
} from "../types/file-commands.js";

const DEFAULT_MAX_BYTES = 1_000_000; // 1 MB

export async function handleFileList(
  input: FileListInput,
  whitelist: WhitelistEntry[],
): Promise<FileCommandResult<FileListOutput>> {
  const canonical = canonicalizePath(input.path);
  const access = validateReadAccess(canonical, whitelist);
  if (!access.allowed) {
    return { ok: false, error: access.reason!, code: "ACCESS_DENIED" };
  }

  try {
    const entries = fs.readdirSync(canonical, { withFileTypes: true });
    const result: FileListEntry[] = [];

    for (const entry of entries) {
      if (!input.showHidden && entry.name.startsWith(".")) continue;

      const entryPath = path.join(canonical, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      if (entry.isDirectory()) {
        result.push({ name: entry.name, path: entryPath, type: "directory" });

        if (input.recursive) {
          // Validate subdirectory access before recursing
          const subAccess = validateReadAccess(entryPath, whitelist);
          if (subAccess.allowed) {
            const sub = await handleFileList({ ...input, path: entryPath }, whitelist);
            if (sub.ok) {
              result.push(...sub.data.entries);
            }
          }
        }
      } else if (entry.isFile()) {
        const stat = fs.statSync(entryPath);
        result.push({
          name: entry.name,
          path: entryPath,
          type: "file",
          size: stat.size,
          extension: ext || undefined,
          modified_at: stat.mtime.toISOString(),
        });
      }
    }

    return { ok: true, data: { path: canonical, entries: result, totalCount: result.length } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to list directory: ${msg}`, code: "FS_ERROR" };
  }
}

export async function handleFileRead(
  input: FileReadInput,
  whitelist: WhitelistEntry[],
): Promise<FileCommandResult<FileReadOutput>> {
  const canonical = canonicalizePath(input.path);
  const access = validateReadAccess(canonical, whitelist);
  if (!access.allowed) {
    return { ok: false, error: access.reason!, code: "ACCESS_DENIED" };
  }

  try {
    const stat = fs.statSync(canonical);
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
    const encoding = input.encoding ?? "utf8";
    const truncated = stat.size > maxBytes;

    const buf = Buffer.alloc(Math.min(stat.size, maxBytes));
    const fd = fs.openSync(canonical, "r");
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    const content = encoding === "base64" ? buf.toString("base64") : buf.toString("utf8");

    return {
      ok: true,
      data: { path: canonical, content, encoding, size: stat.size, truncated },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read file: ${msg}`, code: "FS_ERROR" };
  }
}

export async function handleFileStat(
  input: FileStatInput,
  whitelist: WhitelistEntry[],
): Promise<FileCommandResult<FileStatOutput>> {
  const canonical = canonicalizePath(input.path);
  const access = validateReadAccess(canonical, whitelist);
  if (!access.allowed) {
    return { ok: false, error: access.reason!, code: "ACCESS_DENIED" };
  }

  try {
    const stat = fs.statSync(canonical);
    const name = path.basename(canonical);
    const directory = path.dirname(canonical);
    const extension = path.extname(name).toLowerCase();

    let type: FileStatOutput["type"] = "file";
    if (stat.isDirectory()) type = "directory";
    else if (stat.isSymbolicLink()) type = "symlink";

    // Check OS-level readability and writability
    let isReadable = false;
    let isWritable = false;
    try {
      fs.accessSync(canonical, fs.constants.R_OK);
      isReadable = true;
    } catch {
      /**/
    }
    try {
      fs.accessSync(canonical, fs.constants.W_OK);
      isWritable = true;
    } catch {
      /**/
    }

    return {
      ok: true,
      data: {
        path: canonical,
        name,
        directory,
        extension,
        size: stat.size,
        type,
        created_at: stat.birthtime.toISOString(),
        modified_at: stat.mtime.toISOString(),
        isReadable,
        isWritable,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot stat path: ${msg}`, code: "FS_ERROR" };
  }
}

export async function handleFileSearchKeyword(
  input: FileSearchKeywordInput,
  whitelist: WhitelistEntry[],
): Promise<FileCommandResult<FileSearchKeywordOutput>> {
  const canonical = canonicalizePath(input.path);
  const access = validateReadAccess(canonical, whitelist);
  if (!access.allowed) {
    return { ok: false, error: access.reason!, code: "ACCESS_DENIED" };
  }

  const keyword = input.caseSensitive ? input.keyword : input.keyword.toLowerCase();
  const maxResults = input.maxResults ?? 50;
  const matches: FileSearchKeywordOutput["matches"] = [];
  let totalFiles = 0;

  function searchInFile(filePath: string): void {
    if (matches.length >= maxResults) return;

    // Simple glob-style pattern filter: e.g. "*.ts" or ".md"
    if (input.filePattern) {
      const ext = path.extname(filePath);
      const pattern = input.filePattern.replace("*", "");
      if (!filePath.endsWith(pattern) && ext !== pattern) return;
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      totalFiles++;

      lines.forEach((line, i) => {
        if (matches.length >= maxResults) return;
        const haystack = input.caseSensitive ? line : line.toLowerCase();
        if (haystack.includes(keyword)) {
          matches.push({ file: filePath, line: i + 1, text: line.trimEnd() });
        }
      });
    } catch {
      // Skip unreadable files silently
    }
  }

  function walkDir(dirPath: string): void {
    if (matches.length >= maxResults) return;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden dirs and node_modules for performance
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subAccess = validateReadAccess(fullPath, whitelist);
          if (subAccess.allowed) walkDir(fullPath);
        } else if (entry.isFile()) {
          searchInFile(fullPath);
        }
      }
    } catch {
      // Skip unreadable dirs silently
    }
  }

  const stat = fs.statSync(canonical);
  if (stat.isDirectory()) {
    walkDir(canonical);
  } else {
    searchInFile(canonical);
  }

  return {
    ok: true,
    data: { path: canonical, keyword: input.keyword, matches, totalFiles },
  };
}
