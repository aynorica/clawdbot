import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";

const _require = createRequire(import.meta.url);
import { initializeDatabase } from "./src/db/schema.js";
import { createMetadataStore } from "./src/db/metadata-store.js";
import { createMetadataSearch } from "./src/search/metadata-search.js";
import { createIndexingQueue } from "./src/sync/indexing-queue.js";
import { createWatcherService } from "./src/sync/watcher-service.js";
import { scanDirectory } from "./src/indexer/initial-scan.js";
import { getWhitelistForNode } from "./src/security/path-validator.js";
import {
  handleFileList,
  handleFileRead,
  handleFileStat,
  handleFileSearchKeyword,
} from "./src/handlers/local-file-handler.js";

// Module-level DB handle — initialized in gateway_start
let db: DatabaseSync | null = null;

// Unsubscribe function for whitelist change listener (set up in gateway_start)
let unsubWhitelistChanged: (() => void) | null = null;

function getDbPath(stateDir: string): string {
  return path.join(stateDir, "file-index.sqlite");
}

// Lazily import onWhitelistChanged from ext-whitelist (optional peer dependency).
// If ext-whitelist is not loaded, this is a no-op.
async function trySubscribeToWhitelistChanges(
  store: ReturnType<typeof createMetadataStore>,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<() => void> {
  try {
    // Dynamic import so ext-file-index doesn't hard-depend on ext-whitelist at load time
    const { onWhitelistChanged } = await import(
      "../ext-whitelist/index.js" as string
    ) as { onWhitelistChanged: (cb: (event: "added" | "removed", entry: { path: string }, allEntries: Array<{ path: string }>) => void | Promise<void>) => () => void };

    return onWhitelistChanged(async (event, entry, allEntries) => {
      if (event === "added") {
        logger.info(`[ext-file-index] Whitelist added: ${entry.path} — scanning...`);
        await scanDirectory(entry.path, store, (count) => {
          logger.info(`[ext-file-index] Scanned ${count} files in ${entry.path}`);
        });
      } else if (event === "removed") {
        logger.info(`[ext-file-index] Whitelist removed: ${entry.path} — purging index...`);
        store.removeByDirectory(entry.path);
        logger.info(`[ext-file-index] Purged index entries under ${entry.path}`);
      }
      // Log remaining whitelist
      logger.info(`[ext-file-index] Whitelist now has ${allEntries.length} entr${allEntries.length === 1 ? "y" : "ies"}`);
    });
  } catch {
    // ext-whitelist is not available — silently skip
    return () => {};
  }
}

const plugin = {
  id: "simpal-file-index",
  name: "SimPal File Index",
  description: "Real-time file metadata index with chokidar watcher",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    // -------------------------------------------------------------------------
    // 1. Initialize DB on gateway_start (provides stateDir via runtime)
    // -------------------------------------------------------------------------
    api.on("gateway_start", (_event, _ctx) => {
      const stateDir = api.runtime.state.resolveStateDir();
      const dbPath = getDbPath(stateDir);
      const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
      db = new DatabaseSync(dbPath);
      initializeDatabase(db);

      const store = createMetadataStore(db);
      const queue = createIndexingQueue(store);
      const watcherService = createWatcherService(queue);

      // Subscribe to whitelist changes from ext-whitelist (if loaded)
      void trySubscribeToWhitelistChanges(store, api.logger).then((unsub) => {
        unsubWhitelistChanged = unsub;
      });

      // Register the watcher as a plugin service so it starts/stops with the gateway
      api.registerService(watcherService);

      // Also run an initial scan as part of the service start via a one-time hook
      // We do it inside another service that runs after the watcher service starts
      api.registerService({
        id: "simpal-file-index-initial-scan",
        async start(ctx) {
          const whitelistedPaths = ctx.config.simpal?.whitelistedPaths;
          if (!whitelistedPaths) return;

          const dirs: string[] = [];
          for (const entries of Object.values(whitelistedPaths)) {
            for (const entry of entries) {
              if (entry.path && !dirs.includes(entry.path)) {
                dirs.push(entry.path);
              }
            }
          }

          for (const dir of dirs) {
            ctx.logger.info(`[ext-file-index] Initial scan: ${dir}`);
            await scanDirectory(dir, store, (count) => {
            ctx.logger.debug?.(`[ext-file-index] Scanned ${count} files in ${dir}`);
            });
          }

          ctx.logger.info("[ext-file-index] Initial scan complete");
        },
      });

      // -----------------------------------------------------------------------
      // 2. Register gateway methods
      // -----------------------------------------------------------------------
      const search = createMetadataSearch(db);

      // files.search — full metadata search
      api.registerGatewayMethod("files.search", ({ params, respond }) => {
        if (!db) {
          respond(false, undefined, { code: "NOT_READY", message: "File index not initialized" });
          return;
        }
        try {
          const results = search.search({
            text: typeof params.text === "string" ? params.text : undefined,
            extension: typeof params.extension === "string" ? params.extension : undefined,
            directory: typeof params.directory === "string" ? params.directory : undefined,
            minSize: typeof params.minSize === "number" ? params.minSize : undefined,
            maxSize: typeof params.maxSize === "number" ? params.maxSize : undefined,
            modifiedAfter:
              typeof params.modifiedAfter === "string" ? params.modifiedAfter : undefined,
            modifiedBefore:
              typeof params.modifiedBefore === "string" ? params.modifiedBefore : undefined,
            limit: typeof params.limit === "number" ? params.limit : 50,
            offset: typeof params.offset === "number" ? params.offset : 0,
          });
          respond(true, { results, count: results.length });
        } catch (err) {
          respond(false, undefined, {
            code: "SEARCH_ERROR",
            message: String(err),
          });
        }
      });

      // files.index.status — index statistics
      api.registerGatewayMethod("files.index.status", ({ respond }) => {
        if (!db) {
          respond(false, undefined, { code: "NOT_READY", message: "File index not initialized" });
          return;
        }
        try {
          const stats = store.getStats();
          const whitelistedPaths = api.config.simpal?.whitelistedPaths ?? {};
          const watchedDirs: string[] = [];
          for (const entries of Object.values(whitelistedPaths)) {
            for (const entry of entries) {
              if (entry.path && !watchedDirs.includes(entry.path)) {
                watchedDirs.push(entry.path);
              }
            }
          }
          respond(true, {
            ...stats,
            watchedDirs,
            isIndexing: false,
          });
        } catch (err) {
          respond(false, undefined, {
            code: "STATUS_ERROR",
            message: String(err),
          });
        }
      });

      // files.index.rebuild — re-scan all whitelisted directories
      api.registerGatewayMethod("files.index.rebuild", async ({ respond }) => {
        if (!db) {
          respond(false, undefined, { code: "NOT_READY", message: "File index not initialized" });
          return;
        }
        try {
          const whitelistedPaths = api.config.simpal?.whitelistedPaths ?? {};
          const dirs: string[] = [];
          for (const entries of Object.values(whitelistedPaths)) {
            for (const entry of entries) {
              if (entry.path && !dirs.includes(entry.path)) {
                dirs.push(entry.path);
              }
            }
          }

          let totalScanned = 0;
          for (const dir of dirs) {
            await scanDirectory(dir, store, (count) => {
              totalScanned = count;
            });
          }

          respond(true, {
            message: "Rebuild complete",
            totalScanned,
            dirs,
          });
        } catch (err) {
          respond(false, undefined, {
            code: "REBUILD_ERROR",
            message: String(err),
          });
        }
      });

      // -----------------------------------------------------------------------
      // 3. Register node file commands (file.list, file.read, file.stat, file.search.keyword)
      // -----------------------------------------------------------------------

      // Helper: resolve whitelist from config for a given nodeId param
      function resolveWhitelist(nodeId: unknown) {
        const id = typeof nodeId === "string" ? nodeId : "master";
        return getWhitelistForNode(api.config, id);
      }

      // file.list — lists directory entries, optionally recursive
      api.registerGatewayMethod("file.list", async ({ params, respond }) => {
        const whitelist = resolveWhitelist(params.nodeId);
        const result = await handleFileList(
          {
            path: typeof params.path === "string" ? params.path : "",
            nodeId: typeof params.nodeId === "string" ? params.nodeId : undefined,
            recursive: typeof params.recursive === "boolean" ? params.recursive : false,
            showHidden: typeof params.showHidden === "boolean" ? params.showHidden : false,
          },
          whitelist,
        );
        if (result.ok) {
          respond(true, result.data);
        } else {
          respond(false, undefined, { code: result.code, message: result.error });
        }
      });

      // file.read — reads file contents (utf8 or base64, with optional byte cap)
      api.registerGatewayMethod("file.read", async ({ params, respond }) => {
        const whitelist = resolveWhitelist(params.nodeId);
        const result = await handleFileRead(
          {
            path: typeof params.path === "string" ? params.path : "",
            nodeId: typeof params.nodeId === "string" ? params.nodeId : undefined,
            encoding:
              params.encoding === "utf8" || params.encoding === "base64"
                ? params.encoding
                : "utf8",
            maxBytes: typeof params.maxBytes === "number" ? params.maxBytes : undefined,
          },
          whitelist,
        );
        if (result.ok) {
          respond(true, result.data);
        } else {
          respond(false, undefined, { code: result.code, message: result.error });
        }
      });

      // file.stat — returns metadata (size, type, dates, permissions) for a path
      api.registerGatewayMethod("file.stat", async ({ params, respond }) => {
        const whitelist = resolveWhitelist(params.nodeId);
        const result = await handleFileStat(
          {
            path: typeof params.path === "string" ? params.path : "",
            nodeId: typeof params.nodeId === "string" ? params.nodeId : undefined,
          },
          whitelist,
        );
        if (result.ok) {
          respond(true, result.data);
        } else {
          respond(false, undefined, { code: result.code, message: result.error });
        }
      });

      // file.search.keyword — grep-style keyword search across a directory tree
      api.registerGatewayMethod("file.search.keyword", async ({ params, respond }) => {
        const whitelist = resolveWhitelist(params.nodeId);
        const result = await handleFileSearchKeyword(
          {
            path: typeof params.path === "string" ? params.path : "",
            keyword: typeof params.keyword === "string" ? params.keyword : "",
            nodeId: typeof params.nodeId === "string" ? params.nodeId : undefined,
            caseSensitive:
              typeof params.caseSensitive === "boolean" ? params.caseSensitive : false,
            maxResults: typeof params.maxResults === "number" ? params.maxResults : undefined,
            filePattern:
              typeof params.filePattern === "string" ? params.filePattern : undefined,
          },
          whitelist,
        );
        if (result.ok) {
          respond(true, result.data);
        } else {
          respond(false, undefined, { code: result.code, message: result.error });
        }
      });

      // -----------------------------------------------------------------------
      // 4. Register file_search agent tool
      // -----------------------------------------------------------------------
      api.registerTool({
        name: "file_search",
        label: "File Search",
        description: "Search files by name, type, date, or full-text",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Full-text search term matched against file names and paths" })),
          extension: Type.Optional(Type.String({ description: "Filter by file extension (e.g. .pdf, .ts)" })),
          directory: Type.Optional(Type.String({ description: "Filter to files under this directory path" })),
          limit: Type.Optional(Type.Number({ description: "Maximum number of results to return (default 50)" })),
        }),
        execute: async (
          _toolCallId: string,
          input: Record<string, unknown>,
        ) => {
          if (!db) return jsonResult({ error: "File index not initialized" });
          const results = search.search({
            text: typeof input.query === "string" ? input.query : undefined,
            extension: typeof input.extension === "string" ? input.extension : undefined,
            directory: typeof input.directory === "string" ? input.directory : undefined,
            limit: typeof input.limit === "number" ? input.limit : 50,
          });
          return jsonResult({ results, count: results.length });
        },
      } as AnyAgentTool);
    });

    // Close DB on gateway_stop
    api.on("gateway_stop", (_event, _ctx) => {
      // Unsubscribe from whitelist change notifications
      if (unsubWhitelistChanged) {
        unsubWhitelistChanged();
        unsubWhitelistChanged = null;
      }
      if (db) {
        db.close();
        db = null;
      }
    });
  },
};

export default plugin;
