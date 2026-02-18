import { watch } from "chokidar";
import type { FSWatcher } from "chokidar";
import type { OpenClawPluginService, OpenClawPluginServiceContext } from "openclaw/plugin-sdk";
import type { createIndexingQueue } from "./indexing-queue.js";

type IndexingQueue = ReturnType<typeof createIndexingQueue>;

export function createWatcherService(queue: IndexingQueue): OpenClawPluginService {
  let watcher: FSWatcher | null = null;

  return {
    id: "simpal-file-index-watcher",

    async start(ctx: OpenClawPluginServiceContext): Promise<void> {
      // Resolve whitelisted directories from config
      // whitelistedPaths: Record<string, Array<{path: string, permission: string}>>
      // Keys are device IDs (e.g. "master"), values are arrays of {path, permission}
      const whitelistedPaths = ctx.config.simpal?.whitelistedPaths;
      const dirs: string[] = [];

      if (whitelistedPaths) {
        for (const entries of Object.values(whitelistedPaths)) {
          for (const entry of entries) {
            if (entry.path && !dirs.includes(entry.path)) {
              dirs.push(entry.path);
            }
          }
        }
      }

      if (dirs.length === 0) {
        ctx.logger.info("[ext-file-index] No whitelisted directories configured — watcher idle");
        return;
      }

      ctx.logger.info(
        `[ext-file-index] Starting watcher on ${dirs.length} director${dirs.length === 1 ? "y" : "ies"}`,
      );

      watcher = watch(dirs, {
        persistent: true,
        ignoreInitial: false,
        // Ignore hidden files/dirs (dotfiles)
        ignored: /(^|[/\\])\../,
        // Ignore node_modules
        followSymlinks: false,
      });

      watcher.on("add", (filePath: string) => {
        queue.enqueue("add", filePath);
      });

      watcher.on("change", (filePath: string) => {
        queue.enqueue("change", filePath);
      });

      watcher.on("unlink", (filePath: string) => {
        queue.enqueue("unlink", filePath);
      });

      watcher.on("error", (err: unknown) => {
        ctx.logger.warn(`[ext-file-index] Watcher error: ${String(err)}`);
      });
    },

    async stop(_ctx: OpenClawPluginServiceContext): Promise<void> {
      queue.stop();
      if (watcher) {
        await watcher.close();
        watcher = null;
      }
    },
  };
}
