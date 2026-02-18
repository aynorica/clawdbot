/**
 * Integration tests for ext-whitelist (whitelist-store functions).
 * Tests the pure functional API: addEntry, removeEntry, getMasterEntries,
 * onWhitelistChanged, notifyWhitelistChanged, canonicalizeWhitelistPath.
 */
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";

import {
  addEntry,
  removeEntry,
  getMasterEntries,
  onWhitelistChanged,
  notifyWhitelistChanged,
  canonicalizeWhitelistPath,
} from "../../ext-whitelist/src/whitelist-store.js";
import type { WhitelistEntry } from "../../ext-whitelist/src/whitelist-store.js";

describe("ext-whitelist — store integration", () => {
  describe("getMasterEntries", () => {
    it("returns empty array when config is undefined", () => {
      expect(getMasterEntries(undefined)).toEqual([]);
    });

    it("returns empty array when master key is missing", () => {
      expect(getMasterEntries({})).toEqual([]);
    });

    it("returns entries for master device", () => {
      const entry: WhitelistEntry = { path: "/home/user/docs", permission: "read" };
      const record = { master: [entry] };
      expect(getMasterEntries(record)).toEqual([entry]);
    });
  });

  describe("addEntry", () => {
    it("adds a new entry to an empty whitelist", () => {
      const updated = addEntry(undefined, { path: "/docs", permission: "read" });
      const entries = getMasterEntries(updated);
      expect(entries.length).toBe(1);
      expect(entries[0].path).toBe("/docs");
      expect(entries[0].permission).toBe("read");
    });

    it("adds multiple distinct entries", () => {
      let record = addEntry(undefined, { path: "/docs", permission: "read" });
      record = addEntry(record, { path: "/projects", permission: "read+write" });
      const entries = getMasterEntries(record);
      expect(entries.length).toBe(2);
    });

    it("updates permission when adding a duplicate path (no duplication)", () => {
      let record = addEntry(undefined, { path: "/docs", permission: "read" });
      record = addEntry(record, { path: "/docs", permission: "read+write" });
      const entries = getMasterEntries(record);
      expect(entries.length).toBe(1);
      expect(entries[0].permission).toBe("read+write");
    });

    it("does not mutate the original record", () => {
      const original = { master: [{ path: "/docs", permission: "read" as const }] };
      const updated = addEntry(original, { path: "/photos", permission: "read" });
      // original should still have only 1 entry
      expect(original.master.length).toBe(1);
      // updated should have 2 entries
      expect(getMasterEntries(updated).length).toBe(2);
    });

    it("supports read+write+external permission", () => {
      const updated = addEntry(undefined, { path: "/external", permission: "read+write+external" });
      expect(getMasterEntries(updated)[0].permission).toBe("read+write+external");
    });
  });

  describe("removeEntry", () => {
    it("removes an entry by path", () => {
      let record = addEntry(undefined, { path: "/docs", permission: "read" });
      record = addEntry(record, { path: "/photos", permission: "read" });
      record = removeEntry(record, "/docs");
      const entries = getMasterEntries(record);
      expect(entries.length).toBe(1);
      expect(entries[0].path).toBe("/photos");
    });

    it("returns unchanged record when path is not found", () => {
      let record = addEntry(undefined, { path: "/docs", permission: "read" });
      record = removeEntry(record, "/nonexistent");
      expect(getMasterEntries(record).length).toBe(1);
    });

    it("does not mutate the original record", () => {
      const original = { master: [{ path: "/docs", permission: "read" as const }] };
      removeEntry(original, "/docs");
      expect(original.master.length).toBe(1);
    });

    it("returns empty master array when last entry is removed", () => {
      let record = addEntry(undefined, { path: "/docs", permission: "read" });
      record = removeEntry(record, "/docs");
      expect(getMasterEntries(record).length).toBe(0);
    });
  });

  describe("canonicalizeWhitelistPath", () => {
    it("resolves an absolute path unchanged (normalized)", () => {
      const abs = path.resolve("/home/user/docs");
      expect(canonicalizeWhitelistPath("/home/user/docs")).toBe(abs);
    });

    it("resolves a relative path to absolute", () => {
      const resolved = canonicalizeWhitelistPath("./docs");
      expect(path.isAbsolute(resolved)).toBe(true);
    });

    it("resolves path traversal sequences", () => {
      const resolved = canonicalizeWhitelistPath("/home/user/docs/../photos");
      expect(resolved).toBe(path.resolve("/home/user/photos"));
    });

    it("handles double slashes by normalizing", () => {
      const resolved = canonicalizeWhitelistPath("/home//user//docs");
      expect(path.isAbsolute(resolved)).toBe(true);
      // Should not contain double slashes after normalization
      expect(resolved).not.toContain("//");
    });
  });

  describe("onWhitelistChanged / notifyWhitelistChanged", () => {
    it("fires callback on add event", async () => {
      const events: Array<{ event: string; entry: WhitelistEntry }> = [];

      const unsubscribe = onWhitelistChanged((event, entry) => {
        events.push({ event, entry });
      });

      try {
        const entry: WhitelistEntry = { path: "/docs", permission: "read" };
        await notifyWhitelistChanged("added", entry, [entry]);

        expect(events.length).toBe(1);
        expect(events[0].event).toBe("added");
        expect(events[0].entry.path).toBe("/docs");
      } finally {
        unsubscribe();
      }
    });

    it("fires callback on remove event", async () => {
      const events: Array<{ event: string; entry: WhitelistEntry }> = [];

      const unsubscribe = onWhitelistChanged((event, entry) => {
        events.push({ event, entry });
      });

      try {
        const entry: WhitelistEntry = { path: "/docs", permission: "read" };
        await notifyWhitelistChanged("removed", entry, []);

        expect(events.length).toBe(1);
        expect(events[0].event).toBe("removed");
        expect(events[0].entry.path).toBe("/docs");
      } finally {
        unsubscribe();
      }
    });

    it("passes correct allEntries snapshot to callback", async () => {
      const snapshots: WhitelistEntry[][] = [];

      const unsubscribe = onWhitelistChanged((_event, _entry, allEntries) => {
        snapshots.push(allEntries);
      });

      try {
        const entries: WhitelistEntry[] = [
          { path: "/a", permission: "read" },
          { path: "/b", permission: "read+write" },
        ];
        await notifyWhitelistChanged("added", entries[1], entries);
        expect(snapshots[0]).toEqual(entries);
      } finally {
        unsubscribe();
      }
    });

    it("unsubscribe stops future notifications", async () => {
      let callCount = 0;
      const unsubscribe = onWhitelistChanged(() => {
        callCount++;
      });

      const entry: WhitelistEntry = { path: "/docs", permission: "read" };
      await notifyWhitelistChanged("added", entry, [entry]);
      expect(callCount).toBe(1);

      unsubscribe();

      await notifyWhitelistChanged("added", entry, [entry]);
      expect(callCount).toBe(1); // No additional calls after unsubscribe
    });

    it("multiple callbacks all fire", async () => {
      const callLog: string[] = [];

      const unsub1 = onWhitelistChanged(() => { callLog.push("cb1"); });
      const unsub2 = onWhitelistChanged(() => { callLog.push("cb2"); });

      try {
        const entry: WhitelistEntry = { path: "/docs", permission: "read" };
        await notifyWhitelistChanged("added", entry, [entry]);
        expect(callLog).toContain("cb1");
        expect(callLog).toContain("cb2");
      } finally {
        unsub1();
        unsub2();
      }
    });
  });

  describe("list entries for a specific device", () => {
    it("getMasterEntries returns only master entries, not other device entries", () => {
      const record = {
        master: [{ path: "/docs", permission: "read" as const }],
        "pi-node": [{ path: "/sd-card", permission: "read+write" as const }],
      };
      const master = getMasterEntries(record);
      expect(master.length).toBe(1);
      expect(master[0].path).toBe("/docs");
    });
  });
});
