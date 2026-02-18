import path from "node:path";

export type WhitelistEntry = {
  path: string;
  permission: "read" | "read+write" | "read+write+external";
};

export type WhitelistChangedCallback = (
  event: "added" | "removed",
  entry: WhitelistEntry,
  allEntries: WhitelistEntry[],
) => void | Promise<void>;

const changeCallbacks = new Set<WhitelistChangedCallback>();

/**
 * Register a callback to be notified when the whitelist changes.
 * Called by ext-file-index or other extensions that need to react.
 */
export function onWhitelistChanged(cb: WhitelistChangedCallback): () => void {
  changeCallbacks.add(cb);
  return () => {
    changeCallbacks.delete(cb);
  };
}

/**
 * Notify all registered callbacks of a whitelist change.
 * Called internally by ext-whitelist after persisting a change.
 */
export async function notifyWhitelistChanged(
  event: "added" | "removed",
  entry: WhitelistEntry,
  allEntries: WhitelistEntry[],
): Promise<void> {
  for (const cb of changeCallbacks) {
    await cb(event, entry, allEntries);
  }
}

/**
 * Canonicalize and validate a path string.
 * Returns the resolved absolute path.
 */
export function canonicalizeWhitelistPath(inputPath: string): string {
  return path.resolve(inputPath);
}

/**
 * Read the current whitelist for the "master" device from a whitelistedPaths record.
 */
export function getMasterEntries(
  whitelistedPaths: Record<string, WhitelistEntry[]> | undefined,
): WhitelistEntry[] {
  if (!whitelistedPaths) return [];
  return whitelistedPaths["master"] ?? [];
}

/**
 * Add an entry to the master device whitelist.
 * Returns the updated record (does not mutate in place).
 */
export function addEntry(
  whitelistedPaths: Record<string, WhitelistEntry[]> | undefined,
  entry: WhitelistEntry,
): Record<string, WhitelistEntry[]> {
  const current = getMasterEntries(whitelistedPaths);
  const exists = current.some((e) => e.path === entry.path);
  if (exists) {
    // Update permission if path already exists
    const updated = current.map((e) => (e.path === entry.path ? { ...e, permission: entry.permission } : e));
    return { ...(whitelistedPaths ?? {}), master: updated };
  }
  return { ...(whitelistedPaths ?? {}), master: [...current, entry] };
}

/**
 * Remove an entry from the master device whitelist by path.
 * Returns the updated record (does not mutate in place).
 */
export function removeEntry(
  whitelistedPaths: Record<string, WhitelistEntry[]> | undefined,
  canonicalPath: string,
): Record<string, WhitelistEntry[]> {
  const current = getMasterEntries(whitelistedPaths);
  const filtered = current.filter((e) => e.path !== canonicalPath);
  return { ...(whitelistedPaths ?? {}), master: filtered };
}
