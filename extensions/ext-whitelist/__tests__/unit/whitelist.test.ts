import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import {
  canonicalizeWhitelistPath,
  getMasterEntries,
  addEntry,
  removeEntry,
  onWhitelistChanged,
  notifyWhitelistChanged,
} from "../../src/whitelist-store.js";
import type { WhitelistEntry } from "../../src/whitelist-store.js";

describe("canonicalizeWhitelistPath", () => {
  it("resolves a relative path to an absolute path", () => {
    const result = canonicalizeWhitelistPath("some/relative/path");
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("normalizes an already-absolute path", () => {
    const abs = path.join(process.cwd(), "some", "dir");
    expect(canonicalizeWhitelistPath(abs)).toBe(abs);
  });

  it("resolves path traversal sequences", () => {
    const p = "/foo/bar/../baz";
    const result = canonicalizeWhitelistPath(p);
    expect(result).not.toContain("..");
  });
});

describe("getMasterEntries", () => {
  it("returns empty array when whitelistedPaths is undefined", () => {
    expect(getMasterEntries(undefined)).toEqual([]);
  });

  it("returns entries for master device", () => {
    const entry: WhitelistEntry = { path: "/home/user/docs", permission: "read" };
    const wl = { master: [entry] };
    expect(getMasterEntries(wl)).toEqual([entry]);
  });

  it("returns empty array when master key is absent", () => {
    const wl = { other: [{ path: "/x", permission: "read" as const }] };
    expect(getMasterEntries(wl)).toEqual([]);
  });
});

describe("addEntry", () => {
  it("adds a new entry when the path does not exist", () => {
    const entry: WhitelistEntry = { path: "/home/user/docs", permission: "read" };
    const result = addEntry(undefined, entry);
    expect(result.master).toHaveLength(1);
    expect(result.master[0]).toEqual(entry);
  });

  it("updates permission when path already exists", () => {
    const existing: WhitelistEntry = { path: "/home/user/docs", permission: "read" };
    const wl = { master: [existing] };
    const updated = addEntry(wl, { path: "/home/user/docs", permission: "read+write" });
    expect(updated.master).toHaveLength(1);
    expect(updated.master[0].permission).toBe("read+write");
  });

  it("appends to existing entries without mutation", () => {
    const existing: WhitelistEntry[] = [{ path: "/a", permission: "read" }];
    const wl = { master: existing };
    const result = addEntry(wl, { path: "/b", permission: "read+write" });
    expect(result.master).toHaveLength(2);
    // original array should not be mutated
    expect(existing).toHaveLength(1);
  });

  it("preserves other device entries", () => {
    const wl = {
      master: [{ path: "/a", permission: "read" as const }],
      otherDevice: [{ path: "/z", permission: "read" as const }],
    };
    const result = addEntry(wl, { path: "/b", permission: "read" });
    expect(result.otherDevice).toEqual(wl.otherDevice);
  });
});

describe("removeEntry", () => {
  it("removes an entry by canonical path", () => {
    const wl = {
      master: [
        { path: "/a", permission: "read" as const },
        { path: "/b", permission: "read+write" as const },
      ],
    };
    const result = removeEntry(wl, "/a");
    expect(result.master).toHaveLength(1);
    expect(result.master[0].path).toBe("/b");
  });

  it("leaves the list unchanged when path is not found", () => {
    const wl = { master: [{ path: "/a", permission: "read" as const }] };
    const result = removeEntry(wl, "/nonexistent");
    expect(result.master).toHaveLength(1);
  });

  it("returns empty master array when all entries removed", () => {
    const wl = { master: [{ path: "/a", permission: "read" as const }] };
    const result = removeEntry(wl, "/a");
    expect(result.master).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const entries: WhitelistEntry[] = [{ path: "/a", permission: "read" }];
    const wl = { master: entries };
    removeEntry(wl, "/a");
    expect(entries).toHaveLength(1);
  });
});

describe("onWhitelistChanged / notifyWhitelistChanged", () => {
  beforeEach(() => {
    // Clear any registered callbacks between tests by calling the unsubscribe
    // returned by each registration
  });

  it("calls registered callback when notifyWhitelistChanged is invoked", async () => {
    const spy = vi.fn();
    const unsub = onWhitelistChanged(spy);

    const entry: WhitelistEntry = { path: "/test", permission: "read" };
    await notifyWhitelistChanged("added", entry, [entry]);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith("added", entry, [entry]);

    unsub();
  });

  it("does not call callback after unsubscribe", async () => {
    const spy = vi.fn();
    const unsub = onWhitelistChanged(spy);
    unsub();

    const entry: WhitelistEntry = { path: "/test", permission: "read" };
    await notifyWhitelistChanged("added", entry, [entry]);

    expect(spy).not.toHaveBeenCalled();
  });

  it("calls multiple registered callbacks", async () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    const unsub1 = onWhitelistChanged(spy1);
    const unsub2 = onWhitelistChanged(spy2);

    const entry: WhitelistEntry = { path: "/shared", permission: "read+write" };
    await notifyWhitelistChanged("removed", entry, []);

    expect(spy1).toHaveBeenCalledOnce();
    expect(spy2).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });
});
