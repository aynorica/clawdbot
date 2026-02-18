/**
 * Integration tests for path security.
 * Tests validateReadAccess, validateWriteAccess, and canonicalizePath from ext-file-index.
 */
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  canonicalizePath,
  validateReadAccess,
  validateWriteAccess,
} from "../../ext-file-index/src/security/path-validator.js";
import type { WhitelistEntry } from "../../ext-file-index/src/security/path-validator.js";

// Helper to build a whitelist with one read+write entry
function readWriteList(dir: string): WhitelistEntry[] {
  return [{ path: dir, permission: "read+write" }];
}

function readOnlyList(dir: string): WhitelistEntry[] {
  return [{ path: dir, permission: "read" }];
}

describe("path-validator — canonicalizePath", () => {
  it("resolves an absolute path", () => {
    const p = path.resolve("/home/user/docs");
    expect(canonicalizePath("/home/user/docs")).toBe(p);
  });

  it("resolves relative paths to absolute", () => {
    const result = canonicalizePath("./docs");
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("collapses .. sequences", () => {
    const result = canonicalizePath("/home/user/docs/../photos");
    expect(result).toBe(path.normalize(path.resolve("/home/user/photos")));
  });

  it("collapses nested .. traversal", () => {
    const result = canonicalizePath("/home/user/docs/../../etc/passwd");
    expect(result).toBe(path.normalize(path.resolve("/home/etc/passwd")));
  });
});

describe("path-validator — validateReadAccess (Windows paths on Windows)", () => {
  it("allows a file inside a whitelisted directory", () => {
    const dir = path.resolve("/home/user/docs");
    const file = path.join(dir, "readme.md");
    const result = validateReadAccess(file, readOnlyList(dir));
    expect(result.allowed).toBe(true);
  });

  it("allows a file in a subdirectory of a whitelisted directory", () => {
    const dir = path.resolve("/home/user/docs");
    const file = path.join(dir, "sub", "deep", "file.txt");
    const result = validateReadAccess(file, readOnlyList(dir));
    expect(result.allowed).toBe(true);
  });

  it("rejects a file outside all whitelisted directories", () => {
    const dir = path.resolve("/home/user/docs");
    const file = path.resolve("/home/user/photos/vacation.jpg");
    const result = validateReadAccess(file, readOnlyList(dir));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects a path outside whitelist even with similar prefix (prefix-attack)", () => {
    const dir = path.resolve("/home/user/docs");
    // "/home/user/docs-evil" should NOT be treated as inside "/home/user/docs"
    const evil = path.resolve("/home/user/docs-evil/file.txt");
    const result = validateReadAccess(evil, readOnlyList(dir));
    expect(result.allowed).toBe(false);
  });

  it("rejects path traversal attack via .. in the file path", () => {
    const dir = path.resolve("/home/user/docs");
    // If path.resolve is used in canonicalizePath, this should resolve to /etc/passwd
    const traversal = path.resolve("/home/user/docs/../../../etc/passwd");
    const result = validateReadAccess(traversal, readOnlyList(dir));
    expect(result.allowed).toBe(false);
  });

  it("rejects empty whitelist", () => {
    const file = path.resolve("/home/user/docs/readme.md");
    const result = validateReadAccess(file, []);
    expect(result.allowed).toBe(false);
  });

  it("allows access when multiple whitelist entries, one matches", () => {
    const whitelist: WhitelistEntry[] = [
      { path: path.resolve("/home/user/photos"), permission: "read" },
      { path: path.resolve("/home/user/docs"), permission: "read" },
    ];
    const file = path.join(path.resolve("/home/user/docs"), "readme.md");
    const result = validateReadAccess(file, whitelist);
    expect(result.allowed).toBe(true);
  });

  it("allows read access with read+write permission entry", () => {
    const dir = path.resolve("/home/user/docs");
    const file = path.join(dir, "notes.md");
    const result = validateReadAccess(file, readWriteList(dir));
    expect(result.allowed).toBe(true);
  });

  it("allows the whitelisted directory itself (not just children)", () => {
    const dir = path.resolve("/home/user/docs");
    const result = validateReadAccess(dir, readOnlyList(dir));
    expect(result.allowed).toBe(true);
  });
});

describe("path-validator — validateWriteAccess", () => {
  it("allows write to a file in a read+write directory", () => {
    const dir = path.resolve("/home/user/docs");
    const file = path.join(dir, "notes.md");
    const result = validateWriteAccess(file, readWriteList(dir));
    expect(result.allowed).toBe(true);
  });

  it("rejects write to a file in a read-only directory", () => {
    const dir = path.resolve("/home/user/docs");
    const file = path.join(dir, "notes.md");
    const result = validateWriteAccess(file, readOnlyList(dir));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects write to a file outside all whitelisted directories", () => {
    const dir = path.resolve("/home/user/docs");
    const file = path.resolve("/etc/passwd");
    const result = validateWriteAccess(file, readWriteList(dir));
    expect(result.allowed).toBe(false);
  });

  it("rejects write when whitelist is empty", () => {
    const file = path.resolve("/home/user/docs/notes.md");
    const result = validateWriteAccess(file, []);
    expect(result.allowed).toBe(false);
  });

  it("allows write when one entry is read+write+external", () => {
    const dir = path.resolve("/home/user/external");
    const file = path.join(dir, "data.csv");
    const whitelist: WhitelistEntry[] = [{ path: dir, permission: "read+write+external" }];
    const result = validateWriteAccess(file, whitelist);
    expect(result.allowed).toBe(true);
  });

  it("path traversal write attempt is blocked", () => {
    const dir = path.resolve("/home/user/docs");
    // Attacker constructs a path that resolves outside the whitelist
    const traversalTarget = path.resolve("/home/user/docs/../../../tmp/evil.sh");
    const result = validateWriteAccess(traversalTarget, readWriteList(dir));
    expect(result.allowed).toBe(false);
  });
});

describe("path-validator — Windows-style paths", () => {
  it("works with Windows absolute paths if on Windows", () => {
    // This test is meaningful on Windows; on POSIX it still tests resolve behavior
    const isWindows = process.platform === "win32";
    if (isWindows) {
      const dir = "C:\\Users\\user\\docs";
      const file = path.join(dir, "readme.md");
      const result = validateReadAccess(file, [{ path: dir, permission: "read" }]);
      expect(result.allowed).toBe(true);
    } else {
      // POSIX: just assert that resolve is idempotent for regular paths
      const dir = path.resolve("/project/docs");
      expect(canonicalizePath(dir)).toBe(dir);
    }
  });
});
