import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  canonicalizePath,
  validateReadAccess,
  validateWriteAccess,
} from "../../src/security/path-validator.js";

describe("canonicalizePath", () => {
  it("normalizes relative path components", () => {
    const normalDir = path.resolve("/home/user");
    const result = canonicalizePath("/home/user/../user/docs");
    expect(result).not.toContain("..");
    // Should resolve to the actual path
    expect(result.startsWith(normalDir) || result === path.resolve("/home/user/docs")).toBe(true);
  });
});

describe("validateReadAccess", () => {
  const whitelist = [
    { path: "/home/user/docs", permission: "read" as const },
    { path: "/home/user/code", permission: "read+write" as const },
  ];

  it("allows access to whitelisted directory", () => {
    const result = validateReadAccess("/home/user/docs/report.pdf", whitelist);
    expect(result.allowed).toBe(true);
  });

  it("allows access to whitelisted directory itself", () => {
    const result = validateReadAccess("/home/user/docs", whitelist);
    expect(result.allowed).toBe(true);
  });

  it("denies access to non-whitelisted directory", () => {
    const result = validateReadAccess("/home/user/private/secret.txt", whitelist);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("outside all whitelisted");
  });

  it("prevents path traversal attacks", () => {
    // After canonicalization /home/user/docs/../../../etc/passwd resolves outside whitelist
    const result = validateReadAccess("/home/user/docs/../../../etc/passwd", whitelist);
    expect(result.allowed).toBe(false);
  });
});

describe("validateWriteAccess", () => {
  const whitelist = [
    { path: "/home/user/docs", permission: "read" as const },
    { path: "/home/user/code", permission: "read+write" as const },
  ];

  it("allows write to read+write directory", () => {
    const result = validateWriteAccess("/home/user/code/main.ts", whitelist);
    expect(result.allowed).toBe(true);
  });

  it("denies write to read-only directory", () => {
    const result = validateWriteAccess("/home/user/docs/report.pdf", whitelist);
    expect(result.allowed).toBe(false);
  });
});
