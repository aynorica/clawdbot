import type { AuditQuery, AuditStore } from "../db/audit-store.js";
import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk";

export function createQueryHandler(store: AuditStore) {
  return function handleAuditQuery({ params, respond }: GatewayRequestHandlerOptions): void {
    try {
      const filter = (params ?? {}) as AuditQuery;
      const entries = store.query(filter);
      const total = store.getCount(filter);
      respond(true, { entries, total });
    } catch (err) {
      respond(false, undefined, { code: "AUDIT_QUERY_FAILED", message: String(err) });
    }
  };
}

export function createExportHandler(store: AuditStore) {
  return function handleAuditExport({ params, respond }: GatewayRequestHandlerOptions): void {
    try {
      const { format = "json", query = {} } = (params ?? {}) as {
        format?: string;
        query?: AuditQuery;
      };
      const entries = store.query(query);

      if (format === "csv") {
        const headers = ["id", "timestamp", "action", "node_id", "path", "result", "session_id"];
        const rows = entries.map((e) =>
          headers
            .map((h) => {
              const val = (e as Record<string, unknown>)[h] ?? "";
              return typeof val === "string" && val.includes(",") ? `"${val}"` : String(val);
            })
            .join(","),
        );
        const csv = [headers.join(","), ...rows].join("\n");
        respond(true, { data: csv, contentType: "text/csv" });
      } else {
        respond(true, { data: entries, contentType: "application/json" });
      }
    } catch (err) {
      respond(false, undefined, { code: "AUDIT_EXPORT_FAILED", message: String(err) });
    }
  };
}
