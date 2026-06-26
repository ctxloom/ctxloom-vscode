import { describe, expect, it } from "vitest";
import { parseRemotes } from "./remotes-data.js";

describe("parseRemotes", () => {
  it("parses the wire object captured from `remote list --format json`", () => {
    // Captured verbatim from the dev binary.
    const stdout = JSON.stringify({
      remotes: [
        {
          name: "ctxloom-default",
          url: "https://github.com/ctxloom/ctxloom-default",
          trusted: true,
        },
        {
          name: "personal",
          url: "https://github.com/benjaminabbitt/ctxloom-personal",
          trusted: true,
        },
      ],
      count: 2,
    });
    expect(parseRemotes(stdout)).toEqual([
      {
        name: "ctxloom-default",
        url: "https://github.com/ctxloom/ctxloom-default",
        isDefault: false,
        trusted: true,
      },
      {
        name: "personal",
        url: "https://github.com/benjaminabbitt/ctxloom-personal",
        isDefault: false,
        trusted: true,
      },
    ]);
  });

  it("returns an empty array when there are no remotes", () => {
    expect(parseRemotes(JSON.stringify({ remotes: [], count: 0 }))).toEqual([]);
  });

  it("marks untrusted remotes when trusted is false", () => {
    const stdout = JSON.stringify({
      remotes: [{ name: "corp", url: "https://git.example.com/corp/ctxloom", trusted: false }],
    });
    expect(parseRemotes(stdout)).toEqual([
      {
        name: "corp",
        url: "https://git.example.com/corp/ctxloom",
        isDefault: false,
        trusted: false,
      },
    ]);
  });

  it("omits trusted when the field is absent, defaults url to empty", () => {
    const stdout = JSON.stringify({ remotes: [{ name: "bare" }] });
    expect(parseRemotes(stdout)).toEqual([{ name: "bare", url: "", isDefault: false }]);
  });

  it("flags the default remote if the CLI ever emits one", () => {
    const stdout = JSON.stringify({
      remotes: [{ name: "main", url: "u", default: true, trusted: true }],
    });
    expect(parseRemotes(stdout)).toEqual([
      { name: "main", url: "u", isDefault: true, trusted: true },
    ]);
  });

  it("skips entries that lack a string name or aren't objects", () => {
    const stdout = JSON.stringify({
      remotes: [{ url: "no-name" }, { name: 42 }, null, "x", { name: "keep", url: "u" }],
    });
    expect(parseRemotes(stdout)).toEqual([
      { name: "keep", url: "u", isDefault: false },
    ]);
  });

  it("throws when the output isn't an object", () => {
    expect(() => parseRemotes("[]")).toThrow();
    expect(() => parseRemotes('"a string"')).toThrow();
    expect(() => parseRemotes("42")).toThrow();
  });

  it("throws when there is no remotes array", () => {
    expect(() => parseRemotes("{}")).toThrow();
    expect(() => parseRemotes(JSON.stringify({ remotes: "not-an-array" }))).toThrow();
  });

  it("propagates a parse error on invalid JSON", () => {
    expect(() => parseRemotes("not json")).toThrow();
  });
});
