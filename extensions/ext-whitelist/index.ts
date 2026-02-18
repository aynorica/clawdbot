import type { OpenClawPluginApi, AnyAgentTool } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  canonicalizeWhitelistPath,
  getMasterEntries,
  addEntry,
  removeEntry,
  notifyWhitelistChanged,
} from "./src/whitelist-store.js";
import type { WhitelistEntry } from "./src/whitelist-store.js";

// Re-export so ext-file-index can subscribe to whitelist changes
export { onWhitelistChanged } from "./src/whitelist-store.js";
export type { WhitelistEntry, WhitelistChangedCallback } from "./src/whitelist-store.js";

const DEVICE_ID = "master";

const plugin = {
  id: "simpal-whitelist",
  name: "SimPal Whitelist",
  description: "Directory whitelist management for SimPal",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    // -------------------------------------------------------------------------
    // Gateway methods
    // -------------------------------------------------------------------------

    // whitelist.add — adds a directory to the whitelist for the "master" device
    api.registerGatewayMethod("whitelist.add", async ({ params, respond }) => {
      const rawPath = typeof params.path === "string" ? params.path.trim() : "";
      if (!rawPath) {
        respond(false, undefined, { code: "INVALID_PARAMS", message: "path is required" });
        return;
      }

      const permission: WhitelistEntry["permission"] =
        params.permission === "read+write+external"
          ? "read+write+external"
          : params.permission === "read+write"
            ? "read+write"
            : "read";

      const canonicalPath = canonicalizeWhitelistPath(rawPath);
      const newEntry: WhitelistEntry = { path: canonicalPath, permission };

      const currentCfg = api.runtime.config.loadConfig();
      const updatedPaths = addEntry(currentCfg.simpal?.whitelistedPaths, newEntry);

      const nextCfg = {
        ...currentCfg,
        simpal: {
          ...currentCfg.simpal,
          whitelistedPaths: updatedPaths,
        },
      };

      await api.runtime.config.writeConfigFile(nextCfg);

      const allEntries = getMasterEntries(updatedPaths);
      await notifyWhitelistChanged("added", newEntry, allEntries);

      respond(true, {
        message: `Added '${canonicalPath}' to whitelist with permission '${permission}'`,
        path: canonicalPath,
        permission,
        entries: allEntries,
      });
    });

    // whitelist.remove — removes a directory from the whitelist
    api.registerGatewayMethod("whitelist.remove", async ({ params, respond }) => {
      const rawPath = typeof params.path === "string" ? params.path.trim() : "";
      if (!rawPath) {
        respond(false, undefined, { code: "INVALID_PARAMS", message: "path is required" });
        return;
      }

      const canonicalPath = canonicalizeWhitelistPath(rawPath);
      const currentCfg = api.runtime.config.loadConfig();
      const existing = getMasterEntries(currentCfg.simpal?.whitelistedPaths);
      const entry = existing.find((e) => e.path === canonicalPath);

      if (!entry) {
        respond(false, undefined, {
          code: "NOT_FOUND",
          message: `Path '${canonicalPath}' is not in the whitelist`,
        });
        return;
      }

      const updatedPaths = removeEntry(currentCfg.simpal?.whitelistedPaths, canonicalPath);
      const nextCfg = {
        ...currentCfg,
        simpal: {
          ...currentCfg.simpal,
          whitelistedPaths: updatedPaths,
        },
      };

      await api.runtime.config.writeConfigFile(nextCfg);

      const allEntries = getMasterEntries(updatedPaths);
      await notifyWhitelistChanged("removed", entry, allEntries);

      respond(true, {
        message: `Removed '${canonicalPath}' from whitelist`,
        path: canonicalPath,
        entries: allEntries,
      });
    });

    // whitelist.list — returns all whitelisted paths for the "master" device
    api.registerGatewayMethod("whitelist.list", ({ respond }) => {
      const cfg = api.runtime.config.loadConfig();
      const entries = getMasterEntries(cfg.simpal?.whitelistedPaths);
      respond(true, {
        deviceId: DEVICE_ID,
        entries,
        count: entries.length,
      });
    });

    // -------------------------------------------------------------------------
    // Agent tool: whitelist_manage
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "whitelist_manage",
      label: "Whitelist Manager",
      description:
        "Manage the list of directories SimPal is allowed to access. " +
        "Actions: add (add a directory), remove (remove a directory), list (show all).",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("add"),
          Type.Literal("remove"),
          Type.Literal("list"),
        ]),
        path: Type.Optional(
          Type.String({ description: "Absolute or relative path to the directory. Required for add and remove." }),
        ),
        permission: Type.Optional(
          Type.Union([
            Type.Literal("read"),
            Type.Literal("read+write"),
            Type.Literal("read+write+external"),
          ]),
        ),
      }),
      execute: async (_toolCallId: string, input: Record<string, unknown>) => {
        const action = input.action as string;
        const cfg = api.runtime.config.loadConfig();

        if (action === "list") {
          const entries = getMasterEntries(cfg.simpal?.whitelistedPaths);
          return jsonResult({ entries, count: entries.length });
        }

        const rawPath = typeof input.path === "string" ? input.path.trim() : "";
        if (!rawPath) {
          return jsonResult({ error: "path is required for add/remove actions" });
        }
        const canonicalPath = canonicalizeWhitelistPath(rawPath);

        if (action === "add") {
          const permission: WhitelistEntry["permission"] =
            input.permission === "read+write+external"
              ? "read+write+external"
              : input.permission === "read+write"
                ? "read+write"
                : "read";
          const newEntry: WhitelistEntry = { path: canonicalPath, permission };
          const updatedPaths = addEntry(cfg.simpal?.whitelistedPaths, newEntry);
          const nextCfg = {
            ...cfg,
            simpal: { ...cfg.simpal, whitelistedPaths: updatedPaths },
          };
          await api.runtime.config.writeConfigFile(nextCfg);
          const allEntries = getMasterEntries(updatedPaths);
          await notifyWhitelistChanged("added", newEntry, allEntries);
          return jsonResult({ success: true, path: canonicalPath, permission, entries: allEntries });
        }

        if (action === "remove") {
          const existing = getMasterEntries(cfg.simpal?.whitelistedPaths);
          const entry = existing.find((e) => e.path === canonicalPath);
          if (!entry) {
            return jsonResult({ error: `Path '${canonicalPath}' is not in the whitelist` });
          }
          const updatedPaths = removeEntry(cfg.simpal?.whitelistedPaths, canonicalPath);
          const nextCfg = {
            ...cfg,
            simpal: { ...cfg.simpal, whitelistedPaths: updatedPaths },
          };
          await api.runtime.config.writeConfigFile(nextCfg);
          const allEntries = getMasterEntries(updatedPaths);
          await notifyWhitelistChanged("removed", entry, allEntries);
          return jsonResult({ success: true, removed: canonicalPath, entries: allEntries });
        }

        return jsonResult({ error: `Unknown action: ${action}` });
      },
    } as AnyAgentTool);
  },
};

export default plugin;
