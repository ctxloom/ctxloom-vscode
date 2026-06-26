import { describe, expect, it } from "vitest";
import { parseSessionEssence, parseSessions } from "./sessions-data.js";

describe("parseSessions", () => {
  it("maps snake_case wire fields to camelCase Sessions", () => {
    const stdout = JSON.stringify([
      {
        harp_name: "trim-soapy-ogle",
        session_id: "d3c5e174",
        backend: "claude-code",
        project_dir: "/abs/path",
        started_at: "2026-06-24T15:09:45Z",
        ended_at: "2026-06-24T15:10:14Z",
        transcript_path: "/abs/x.jsonl",
        summary: "did a thing",
      },
    ]);
    expect(parseSessions(stdout)).toEqual([
      {
        harpName: "trim-soapy-ogle",
        sessionId: "d3c5e174",
        backend: "claude-code",
        startedAt: "2026-06-24T15:09:45Z",
        endedAt: "2026-06-24T15:10:14Z",
        transcriptPath: "/abs/x.jsonl",
        summary: "did a thing",
        distilled: true,
      },
    ]);
  });

  it("returns an empty array for an empty list", () => {
    expect(parseSessions("[]")).toEqual([]);
  });

  it("skips entries that lack a string harp_name", () => {
    const stdout = JSON.stringify([
      { session_id: "no-harp" },
      { harp_name: 42 },
      { harp_name: "keep-me", session_id: "s1" },
      null,
      "not-an-object",
    ]);
    expect(parseSessions(stdout)).toEqual([
      {
        harpName: "keep-me",
        sessionId: "s1",
        backend: "",
        startedAt: "",
        endedAt: "",
        transcriptPath: "",
        summary: "",
        distilled: false,
      },
    ]);
  });

  it("defaults missing optional string fields to empty strings", () => {
    const stdout = JSON.stringify([{ harp_name: "bare" }]);
    expect(parseSessions(stdout)).toEqual([
      {
        harpName: "bare",
        sessionId: "",
        backend: "",
        startedAt: "",
        endedAt: "",
        transcriptPath: "",
        summary: "",
        distilled: false,
      },
    ]);
  });

  it("throws on output that isn't a JSON array", () => {
    expect(() => parseSessions("{}")).toThrow();
    expect(() => parseSessions('"a string"')).toThrow();
    expect(() => parseSessions("42")).toThrow();
  });

  it("propagates a parse error on invalid JSON", () => {
    expect(() => parseSessions("not json")).toThrow();
  });
});

describe("parseSessionEssence", () => {
  it("returns the essence when distilled", () => {
    const stdout = JSON.stringify({ harp: "h", distilled: true, essence: "# Summary\n..." });
    expect(parseSessionEssence(stdout)).toBe("# Summary\n...");
  });

  it("returns undefined when not distilled", () => {
    const stdout = JSON.stringify({ harp: "h", distilled: false, essence: "" });
    expect(parseSessionEssence(stdout)).toBeUndefined();
  });

  it("returns undefined when distilled but essence is empty", () => {
    expect(parseSessionEssence(JSON.stringify({ distilled: true, essence: "" }))).toBeUndefined();
  });
});
