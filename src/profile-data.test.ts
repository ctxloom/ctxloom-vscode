import { describe, expect, it } from "vitest";
import { parseDryRun, parseProfileDetail } from "./profile-data.js";

describe("parseProfileDetail", () => {
  it("maps declared config including snake_case excludes and default flag", () => {
    const stdout = JSON.stringify({
      name: "reviewer",
      description: "Code review",
      llm: "claude-code",
      parents: ["base"],
      bundles: ["b@bundles/x", "b@bundles/y#fragments/z"],
      tags: ["review"],
      exclude_fragments: ["noisy"],
      exclude_mcp: ["slow-server"],
      path: "/p/reviewer.yaml",
      default: true,
    });
    expect(parseProfileDetail(stdout)).toEqual({
      name: "reviewer",
      description: "Code review",
      llm: "claude-code",
      parents: ["base"],
      bundles: ["b@bundles/x", "b@bundles/y#fragments/z"],
      tags: ["review"],
      excludeFragments: ["noisy"],
      excludeMcp: ["slow-server"],
      path: "/p/reviewer.yaml",
      isDefault: true,
    });
  });

  it("defaults absent fields and filters non-strings", () => {
    expect(parseProfileDetail(JSON.stringify({ name: "p", bundles: ["ok", 7, null] }))).toEqual({
      name: "p",
      description: "",
      llm: "",
      parents: [],
      bundles: ["ok"],
      tags: [],
      excludeFragments: [],
      excludeMcp: [],
      path: "",
      isDefault: false,
    });
  });

  it("throws on non-object output", () => {
    expect(() => parseProfileDetail("[]")).toThrow();
    expect(() => parseProfileDetail("not json")).toThrow();
  });
});

describe("parseDryRun", () => {
  it("maps the resolved assembly", () => {
    const stdout = JSON.stringify({
      llm: "claude-code",
      backend: "claude-code",
      profiles: ["reviewer"],
      fragments: ["b@bundles/x#fragments/a", "builtin:ltk#fragments/ltk"],
      context: "# Assembled\n...",
    });
    expect(parseDryRun(stdout)).toEqual({
      llm: "claude-code",
      backend: "claude-code",
      profiles: ["reviewer"],
      fragments: ["b@bundles/x#fragments/a", "builtin:ltk#fragments/ltk"],
      context: "# Assembled\n...",
    });
  });

  it("defaults absent fields", () => {
    expect(parseDryRun(JSON.stringify({}))).toEqual({
      llm: "",
      backend: "",
      profiles: [],
      fragments: [],
      context: "",
    });
  });

  it("throws on non-object output", () => {
    expect(() => parseDryRun("[]")).toThrow();
  });
});
