import { describe, expect, it, vi } from "vitest";
import {
  OutboundQueue,
  buildRunArgs,
  encodeMessageLine,
  formatToolInput,
  lastStderrLine,
  parseChatEvent,
  truncate,
  wantsMarkdown,
} from "./protocol.js";

describe("encodeMessageLine", () => {
  it("passes plain text through unchanged", () => {
    expect(encodeMessageLine("hello world")).toBe("hello world");
  });

  it("encodes real newlines as the \\n escape the backend decodes", () => {
    expect(encodeMessageLine("a\nb")).toBe("a\\nb");
    expect(encodeMessageLine("a\r\nb")).toBe("a\\nb");
  });

  it("escapes backslashes before newlines so a literal \\n survives round-trip", () => {
    // Input is the two characters backslash + n — must NOT be confused with a
    // newline by the backend, so the backslash is doubled.
    expect(encodeMessageLine("a\\nb")).toBe("a\\\\nb");
  });

  it("escapes backslashes and newlines together unambiguously", () => {
    // backslash, then a real newline.
    expect(encodeMessageLine("a\\\nb")).toBe("a\\\\\\nb");
  });
});

describe("parseChatEvent", () => {
  // A fixed clock so the now() fallback is deterministic under test.
  const clock = () => 1_000;

  it("parses an entry line, stamping at from the clock when no wire timestamp", () => {
    const ev = parseChatEvent('{"entry":{"type":"assistant","content":"hi"}}', clock);
    expect(ev).toEqual({
      kind: "entry",
      entry: { type: "assistant", content: "hi" },
      at: 1_000,
    });
  });

  it("parses a complete line, stamping at from the clock", () => {
    const ev = parseChatEvent('{"complete":{"costUsd":0.01,"model":"opus"}}', clock);
    expect(ev).toEqual({
      kind: "complete",
      complete: { costUsd: 0.01, model: "opus" },
      at: 1_000,
    });
  });

  it("parses a session line, stamping at from the clock", () => {
    const ev = parseChatEvent('{"session":{"model":"opus","mcpServers":[]}}', clock);
    expect(ev).toEqual({
      kind: "session",
      session: { model: "opus", mcpServers: [] },
      at: 1_000,
    });
  });

  it("uses the entry's wire timestamp when the data provides one", () => {
    const ev = parseChatEvent(
      '{"entry":{"type":"thinking","timestamp":"2026-06-01T10:00:00Z"}}',
      clock,
    );
    expect(ev?.at).toBe(Date.parse("2026-06-01T10:00:00Z"));
  });

  it("falls back to now() when the wire timestamp is unparseable", () => {
    const ev = parseChatEvent('{"entry":{"type":"assistant","timestamp":"not-a-date"}}', clock);
    expect(ev?.at).toBe(1_000);
  });

  it("defaults to Date.now when no clock is injected", () => {
    const before = Date.now();
    const ev = parseChatEvent('{"entry":{"type":"assistant","content":"hi"}}');
    const after = Date.now();
    expect(ev?.at).toBeGreaterThanOrEqual(before);
    expect(ev?.at).toBeLessThanOrEqual(after);
  });

  it("returns undefined for non-JSON noise", () => {
    expect(parseChatEvent("ctxloom: starting session foo")).toBeUndefined();
  });

  it("returns undefined for JSON without a known field (e.g. heartbeat)", () => {
    expect(parseChatEvent('{"heartbeat":{}}')).toBeUndefined();
    expect(parseChatEvent("{}")).toBeUndefined();
  });
});

describe("lastStderrLine", () => {
  it("returns the last non-empty trimmed line", () => {
    expect(lastStderrLine("warming up\nError: boom\n")).toBe("Error: boom");
  });

  it("ignores trailing whitespace-only lines", () => {
    expect(lastStderrLine("real error\n   \n\n")).toBe("real error");
  });

  it("returns empty string when there is nothing", () => {
    expect(lastStderrLine("")).toBe("");
    expect(lastStderrLine("   \n  ")).toBe("");
  });
});

describe("buildRunArgs", () => {
  it("defaults to a bare run", () => {
    expect(buildRunArgs({})).toEqual(["run"]);
  });

  it("adds the structured json flags", () => {
    expect(buildRunArgs({ structured: true })).toEqual([
      "run",
      "--structured",
      "--format",
      "json",
    ]);
  });

  it("adds a trimmed profile via -p", () => {
    expect(buildRunArgs({ profile: "  ts-dev  " })).toEqual(["run", "-p", "ts-dev"]);
  });

  it("ignores an empty/whitespace profile", () => {
    expect(buildRunArgs({ profile: "   " })).toEqual(["run"]);
  });

  it("combines structured, profile and new-session in a stable order", () => {
    expect(
      buildRunArgs({ structured: true, profile: "ts-dev", newSession: true }),
    ).toEqual(["run", "--structured", "--format", "json", "-p", "ts-dev", "--new-session"]);
  });
});

describe("formatToolInput", () => {
  it("passes a string through unchanged", () => {
    expect(formatToolInput("ls -la")).toBe("ls -la");
  });

  it("pretty-prints an object as JSON", () => {
    expect(formatToolInput({ command: "ls", cwd: "/tmp" })).toBe(
      JSON.stringify({ command: "ls", cwd: "/tmp" }, null, 2),
    );
  });

  it("pretty-prints an array as JSON", () => {
    expect(formatToolInput([1, 2])).toBe(JSON.stringify([1, 2], null, 2));
  });

  it("renders primitives as their string form", () => {
    expect(formatToolInput(42)).toBe("42");
    expect(formatToolInput(true)).toBe("true");
  });

  it("returns empty string for null/undefined", () => {
    expect(formatToolInput(undefined)).toBe("");
    expect(formatToolInput(null)).toBe("");
  });
});

describe("truncate", () => {
  it("leaves text at or under the limit unchanged", () => {
    expect(truncate("abc", 10)).toBe("abc");
    expect(truncate("abcde", 5)).toBe("abcde");
  });

  it("cuts longer text to the limit and appends an ellipsis", () => {
    expect(truncate("abcdef", 5)).toBe("abcde…");
  });

  it("handles empty input", () => {
    expect(truncate("", 5)).toBe("");
  });
});

describe("wantsMarkdown", () => {
  it("renders prose turns as markdown", () => {
    expect(wantsMarkdown(undefined)).toBe(true);
    expect(wantsMarkdown("assistant")).toBe(true);
    expect(wantsMarkdown("user")).toBe(true);
    expect(wantsMarkdown("system")).toBe(true);
  });

  it("leaves tool and thinking turns as plain text", () => {
    expect(wantsMarkdown("thinking")).toBe(false);
    expect(wantsMarkdown("tool_use")).toBe(false);
    expect(wantsMarkdown("tool_result")).toBe(false);
  });
});

describe("OutboundQueue", () => {
  it("holds messages until the transport is writable", () => {
    const writer = vi.fn();
    const q = new OutboundQueue(writer);
    q.enqueue("first");
    q.enqueue("second");
    expect(writer).not.toHaveBeenCalled();
    expect(q.pendingCount).toBe(2);
  });

  it("flushes held messages in order once writable", () => {
    const sent: string[] = [];
    const q = new OutboundQueue((l) => sent.push(l));
    q.enqueue("first");
    q.enqueue("second");
    q.setWritable(true);
    expect(sent).toEqual(["first", "second"]);
    expect(q.pendingCount).toBe(0);
  });

  it("writes through immediately once writable", () => {
    const sent: string[] = [];
    const q = new OutboundQueue((l) => sent.push(l));
    q.setWritable(true);
    q.enqueue("now");
    expect(sent).toEqual(["now"]);
    expect(q.pendingCount).toBe(0);
  });

  it("re-holds messages when the transport goes unwritable, then flushes again", () => {
    const sent: string[] = [];
    const q = new OutboundQueue((l) => sent.push(l));
    q.setWritable(true);
    q.enqueue("a");
    q.setWritable(false);
    q.enqueue("b");
    expect(sent).toEqual(["a"]);
    expect(q.pendingCount).toBe(1);
    q.setWritable(true);
    expect(sent).toEqual(["a", "b"]);
  });

  it("preserves order across interleaved enqueue/writable toggles", () => {
    const sent: string[] = [];
    const q = new OutboundQueue((l) => sent.push(l));
    q.enqueue("1");
    q.setWritable(true);
    q.enqueue("2");
    q.setWritable(false);
    q.enqueue("3");
    q.enqueue("4");
    q.setWritable(true);
    expect(sent).toEqual(["1", "2", "3", "4"]);
  });
});
