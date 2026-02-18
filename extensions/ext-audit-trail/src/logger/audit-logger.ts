import type { AuditEntry, AuditStore } from "../db/audit-store.js";
import { resolveFilePath, resolveNodeId, sanitizeForAudit } from "./entry-sanitizer.js";

let _store: AuditStore | null = null;

export function setAuditStore(store: AuditStore): void {
  _store = store;
}

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  if (!_store) {
    return; // Silently skip if not initialized yet
  }
  try {
    _store.append(entry);
  } catch {
    // Never let audit failures crash the main process
  }
}

export function appendAuditEntryFromToolCall(params: {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  sessionId?: string;
  agentId?: string;
  blocked?: boolean;
  blockReason?: string;
}): void {
  if (!_store) return;
  try {
    const sanitizedDetails = sanitizeForAudit(params.args, params.result);
    const details = params.blocked
      ? { ...sanitizedDetails, blockReason: params.blockReason }
      : sanitizedDetails;
    const resultValue: AuditEntry["result"] = params.blocked
      ? "blocked"
      : (params.result as Record<string, unknown>)?.error
        ? "error"
        : "success";
    _store.append({
      action: params.toolName,
      node_id: resolveNodeId(params.args),
      path: resolveFilePath(params.args),
      details,
      result: resultValue,
      session_id: params.sessionId,
      agent_id: params.agentId,
    });
  } catch {
    // Never crash on audit errors
  }
}
