import { describe, expect, it } from "vitest";
import { bundleLabel, bundleSource, parseContentList } from "./content-data.js";

describe("parseContentList", () => {
  it("uses the backend-supplied ref for fragments", () => {
    const items = parseContentList(
      JSON.stringify([
        {
          name: "code-quality",
          tags: ["code"],
          bundle: "https://github.com/ctxloom/ctxloom-default@bundles/code-quality",
          ref: "https://github.com/ctxloom/ctxloom-default@bundles/code-quality#fragments/code-quality",
        },
      ]),
      "fragments",
    );
    expect(items).toEqual([
      {
        name: "code-quality",
        tags: ["code"],
        bundle: "https://github.com/ctxloom/ctxloom-default@bundles/code-quality",
        ref: "https://github.com/ctxloom/ctxloom-default@bundles/code-quality#fragments/code-quality",
      },
    ]);
  });

  it("uses the backend-supplied ref for prompts", () => {
    const items = parseContentList(
      JSON.stringify([
        { name: "release", tags: [], bundle: "b@bundles/x", ref: "b@bundles/x#prompts/release" },
      ]),
      "prompts",
    );
    expect(items[0]?.ref).toBe("b@bundles/x#prompts/release");
  });

  it("falls back to constructing the ref when the backend omits it", () => {
    const items = parseContentList(
      JSON.stringify([{ name: "release", tags: [], bundle: "b@bundles/x" }]),
      "prompts",
    );
    expect(items[0]?.ref).toBe("b@bundles/x#prompts/release");
  });

  it("dedupes tags while preserving first-seen order, dropping non-strings", () => {
    const items = parseContentList(
      JSON.stringify([
        { name: "f", tags: ["a", "b", "a", "c", "b", 7, null], bundle: "z", ref: "z#fragments/f" },
      ]),
      "fragments",
    );
    expect(items[0]?.tags).toEqual(["a", "b", "c"]);
  });

  it("skips entries without a string name", () => {
    const items = parseContentList(
      JSON.stringify([
        { tags: ["x"], bundle: "b" },
        { name: 42, bundle: "b" },
        { name: "keep", bundle: "b", ref: "b#fragments/keep" },
      ]),
      "fragments",
    );
    expect(items.map((i) => i.name)).toEqual(["keep"]);
  });

  it("defaults bundle, tags and ref when absent", () => {
    const items = parseContentList(JSON.stringify([{ name: "n" }]), "prompts");
    expect(items[0]).toEqual({ name: "n", tags: [], bundle: "", ref: "#prompts/n" });
  });

  it("throws on output that is not a JSON array", () => {
    expect(() => parseContentList(JSON.stringify({ name: "x" }), "fragments")).toThrow();
    expect(() => parseContentList(JSON.stringify("nope"), "prompts")).toThrow();
  });
});

describe("bundleLabel / bundleSource", () => {
  const ref = "https://github.com/ctxloom/ctxloom-default@bundles/code-quality";
  it("splits a remote bundle ref into source and label", () => {
    expect(bundleSource(ref)).toBe("https://github.com/ctxloom/ctxloom-default");
    expect(bundleLabel(ref)).toBe("code-quality");
  });
  it("returns the whole ref when there is no @bundles/ marker", () => {
    expect(bundleSource("builtin:ltk")).toBe("builtin:ltk");
    expect(bundleLabel("builtin:ltk")).toBe("builtin:ltk");
  });
});
