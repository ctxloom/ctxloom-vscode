import { describe, expect, it } from "vitest";
import { parsePlans } from "./plans-data.js";

describe("parsePlans", () => {
  it("maps plan fields and keeps the sessions list", () => {
    const stdout = JSON.stringify([
      {
        path: "/home/u/.ctxloom/sessions/alpha/design.plan.md",
        name: "design",
        title: "Alpha Design",
        session: "alpha",
        sessions: ["alpha", "beta"],
      },
    ]);
    expect(parsePlans(stdout)).toEqual([
      {
        path: "/home/u/.ctxloom/sessions/alpha/design.plan.md",
        name: "design",
        title: "Alpha Design",
        session: "alpha",
        sessions: ["alpha", "beta"],
      },
    ]);
  });

  it("falls back to name for the title and to [] for a null sessions list", () => {
    const stdout = JSON.stringify([
      { path: "/p/rollout.plan.md", name: "rollout", title: "", session: "beta", sessions: null },
    ]);
    expect(parsePlans(stdout)).toEqual([
      { path: "/p/rollout.plan.md", name: "rollout", title: "rollout", session: "beta", sessions: [] },
    ]);
  });

  it("skips entries without a string path and filters non-string sessions", () => {
    const stdout = JSON.stringify([
      { name: "no-path" },
      { path: 42 },
      { path: "/p/x.plan.md", name: "x", title: "X", session: "s", sessions: ["a", 7, null, "b"] },
    ]);
    expect(parsePlans(stdout)).toEqual([
      { path: "/p/x.plan.md", name: "x", title: "X", session: "s", sessions: ["a", "b"] },
    ]);
  });

  it("returns an empty list for an empty array", () => {
    expect(parsePlans("[]")).toEqual([]);
  });

  it("throws on output that isn't a JSON array", () => {
    expect(() => parsePlans("{}")).toThrow();
    expect(() => parsePlans("not json")).toThrow();
  });
});
