import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { initializeDatabase } from "./src/db/schema.js";
import { createAuditStore } from "./src/db/audit-store.js";
import {
  setAuditStore,
  appendAuditEntry,
  appendAuditEntryFromToolCall,
} from "./src/logger/audit-logger.js";
import { createQueryHandler, createExportHandler } from "./src/query/query-handler.js";

const _require = createRequire(import.meta.url);
let db: DatabaseSync | null = null;

function getAuditDbPath(stateDir: string): string {
  return path.join(stateDir, "audit.sqlite");
}

const plugin = {
  id: "simpal-audit-trail",
  name: "SimPal Audit Trail",
  description: "Immutable forensic logging of all actions across all nodes",
  version: "0.1.0",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" as const, default: true },
      retentionDays: { type: "number" as const, default: 365 },
    },
  },
  register(api: OpenClawPluginApi) {
    // Initialize DB on gateway start.
    // gateway_start event: { port: number }; ctx: { port?: number }
    // State dir is resolved via api.runtime.state.resolveStateDir()
    api.on("gateway_start", (_event, _ctx) => {
      const stateDir = api.runtime.state.resolveStateDir();
      const dbPath = getAuditDbPath(stateDir);
      const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
      db = new DatabaseSync(dbPath);
      initializeDatabase(db);
      const store = createAuditStore(db);
      setAuditStore(store);

      // Register gateway methods now that the store is ready
      api.registerGatewayMethod("audit.query", createQueryHandler(store));
      api.registerGatewayMethod("audit.export", createExportHandler(store));
    });

    // Close DB on gateway stop
    // gateway_stop event: { reason?: string }; ctx: { port?: number }
    api.on("gateway_stop", (_event, _ctx) => {
      if (db) {
        db.close();
        db = null;
      }
    });


    // Log every tool call (after_tool_call is a void hook)
    // event: { toolName, params, result?, error?, durationMs? }
    // ctx:   { agentId?, sessionKey?, toolName }
    api.on("after_tool_call", (event, ctx) => {
      appendAuditEntryFromToolCall({
        toolName: event.toolName,
        args: event.params,
        result: event.result ?? (event.error ? { error: event.error } : null),
        sessionId: ctx.sessionKey,
        agentId: ctx.agentId,
      });
    });

    // Log blocked tool calls (before_tool_call is a modifying hook; return block=true to block)
    // event: { toolName, params }
    // ctx:   { agentId?, sessionKey?, toolName }
    // We only observe here (return nothing) but log when this runs for blocked calls.
    // NOTE: the hook itself doesn't carry a `blocked` flag. To detect blocking we would need
    // to combine with after_tool_call error, but the cleanest approach is to register a
    // separate before_tool_call hook with low priority that just logs the attempt.
    api.on(
      "before_tool_call",
      (event, ctx) => {
        // Log the attempt — result will be determined after execution
        // This is the observe-only path; actual block detection happens in after_tool_call
        void appendAuditEntry({
          action: `before:${event.toolName}`,
          node_id: "master",
          path:
            typeof event.params.path === "string"
              ? event.params.path
              : typeof event.params.filePath === "string"
                ? event.params.filePath
                : undefined,
          details: { sessionKey: ctx.sessionKey, agentId: ctx.agentId },
          result: "success",
          session_id: ctx.sessionKey,
          agent_id: ctx.agentId,
        });
        // Return undefined (do not block)
        return undefined;
      },
      { priority: 1000 }, // run last so other plugins can block first
    );

    // Log LLM calls (llm_input is a void hook with two args: event, ctx)
    // event: { runId, sessionId, provider, model, systemPrompt?, prompt, historyMessages, imagesCount }
    // ctx:   { agentId?, sessionKey? }  (PluginHookAgentContext)
    api.on("llm_input", (event, ctx) => {
      void appendAuditEntry({
        action: "LLM_CALL",
        details: {
          runId: event.runId,
          provider: event.provider,
          model: event.model,
          messageCount: event.historyMessages.length,
          imagesCount: event.imagesCount,
        },
        result: "success",
        session_id: event.sessionId,
        agent_id: ctx.agentId,
        node_id: "master",
      });
    });
  },
};

export default plugin;
