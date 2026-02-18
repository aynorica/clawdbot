import { describe, it, expect } from "vitest";
import {
  sanitizeForAudit,
  resolveNodeId,
  resolveFilePath,
} from "../../src/logger/entry-sanitizer.js";

describe("sanitizeForAudit", () => {
  it("removes content fields", () => {
    const args = {
      path: "/tmp/test.txt",
      content: "secret content",
      fileContent: "more secrets",
    };
    const result = sanitizeForAudit(args, null);
    expect(result.content).toBeUndefined();
    expect(result.fileContent).toBeUndefined();
    expect(result.path).toBe("/tmp/test.txt");
  });

  it("truncates long strings", () => {
    const longString = "a".repeat(1000);
    const args = { query: longString };
    const result = sanitizeForAudit(args, null);
    expect((result.query as string).length).toBeLessThan(600);
    expect(result.query as string).toContain("[truncated]");
  });
});

describe("resolveNodeId", () => {
  it("extracts nodeId from args", () => {
    expect(resolveNodeId({ nodeId: "my-device" })).toBe("my-device");
  });

  it("defaults to master", () => {
    expect(resolveNodeId({})).toBe("master");
  });
});

describe("resolveFilePath", () => {
  it("extracts path from args", () => {
    expect(resolveFilePath({ path: "/home/user/file.txt" })).toBe("/home/user/file.txt");
  });

  it("returns undefined when no path", () => {
    expect(resolveFilePath({})).toBeUndefined();
  });
});
