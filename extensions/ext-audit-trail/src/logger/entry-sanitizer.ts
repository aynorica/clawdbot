export function sanitizeForAudit(
  args: Record<string, unknown>,
  result: unknown,
): Record<string, unknown> {
  const sanitized = { ...args };
  // Remove file content — only log metadata about what was read/written
  delete sanitized.content;
  delete sanitized.fileContent;
  delete sanitized.body;

  // Truncate long strings
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string" && value.length > 500) {
      sanitized[key] = value.substring(0, 500) + "...[truncated]";
    }
  }

  // Include result summary
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.error) {
      sanitized._resultError =
        typeof r.error === "string" ? r.error.substring(0, 200) : String(r.error);
    }
  }

  return sanitized;
}

export function resolveNodeId(args: Record<string, unknown>): string {
  const nodeId = args.nodeId ?? args.node_id ?? args.node;
  if (typeof nodeId === "string" && nodeId.trim()) {
    return nodeId.trim();
  }
  return "master";
}

export function resolveFilePath(args: Record<string, unknown>): string | undefined {
  const filePath = args.path ?? args.filePath ?? args.file_path ?? args.src;
  if (typeof filePath === "string" && filePath.trim()) {
    return filePath.trim();
  }
  return undefined;
}
