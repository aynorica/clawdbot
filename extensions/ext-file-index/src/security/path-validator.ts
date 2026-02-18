import path from "node:path";

export type WhitelistEntry = {
  path: string;
  permission: "read" | "read+write" | "read+write+external";
};

export function canonicalizePath(inputPath: string): string {
  // Normalize slashes, resolve . and .., return absolute path
  return path.normalize(path.resolve(inputPath));
}

export function validateReadAccess(
  filePath: string,
  whitelist: WhitelistEntry[],
): { allowed: boolean; reason?: string } {
  const canonical = canonicalizePath(filePath);

  for (const entry of whitelist) {
    const canonicalDir = canonicalizePath(entry.path);
    // Check if filePath is inside or equal to the whitelisted directory
    if (canonical.startsWith(canonicalDir + path.sep) || canonical === canonicalDir) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Path '${filePath}' is outside all whitelisted directories`,
  };
}

export function validateWriteAccess(
  filePath: string,
  whitelist: WhitelistEntry[],
): { allowed: boolean; reason?: string } {
  const canonical = canonicalizePath(filePath);

  for (const entry of whitelist) {
    if (entry.permission === "read") continue; // skip read-only entries
    const canonicalDir = canonicalizePath(entry.path);
    if (canonical.startsWith(canonicalDir + path.sep) || canonical === canonicalDir) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Path '${filePath}' is not in a writable whitelisted directory`,
  };
}

export function getWhitelistForNode(
  config: { simpal?: { whitelistedPaths?: Record<string, WhitelistEntry[]> } },
  nodeId: string,
): WhitelistEntry[] {
  const wl = config.simpal?.whitelistedPaths;
  if (!wl) return [];
  return wl[nodeId] ?? wl["master"] ?? [];
}
