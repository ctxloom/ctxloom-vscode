import { describe, expect, it } from "vitest";
import { parseProfiles } from "./profiles.js";

const SAMPLE = JSON.stringify([
  {
    name: "https://github.com/ctxloom/ctxloom-default@profiles/default",
    display_name: "default",
    description: "Baseline profile seeded by ctxloom init.",
    bundles: ["x"],
    is_remote: true,
  },
  {
    name: "ts-dev",
    display_name: "ts-dev",
    description: "TypeScript development for the ctxloom-vscode extension",
    bundles: ["y"],
    default: true,
    is_remote: false,
  },
]);

describe("parseProfiles", () => {
  it("maps name, display name, description, default and remote flags", () => {
    expect(parseProfiles(SAMPLE)).toEqual([
      {
        name: "https://github.com/ctxloom/ctxloom-default@profiles/default",
        displayName: "default",
        description: "Baseline profile seeded by ctxloom init.",
        isDefault: false,
        isRemote: true,
      },
      {
        name: "ts-dev",
        displayName: "ts-dev",
        description: "TypeScript development for the ctxloom-vscode extension",
        isDefault: true,
        isRemote: false,
      },
    ]);
  });

  it("returns an empty list for an empty array", () => {
    expect(parseProfiles("[]")).toEqual([]);
  });

  it("falls back to name when display_name is absent, defaults flags", () => {
    expect(parseProfiles('[{"name":"p"}]')).toEqual([
      { name: "p", displayName: "p", description: "", isDefault: false, isRemote: false },
    ]);
  });

  it("skips entries without a string name", () => {
    expect(parseProfiles('[{"description":"no name"},{"name":42},{"name":"ok"}]')).toEqual([
      { name: "ok", displayName: "ok", description: "", isDefault: false, isRemote: false },
    ]);
  });

  it("throws on non-array JSON so the caller can surface it", () => {
    expect(() => parseProfiles('{"name":"p"}')).toThrow();
  });

  it("throws on non-JSON output", () => {
    expect(() => parseProfiles("not json")).toThrow();
  });
});
