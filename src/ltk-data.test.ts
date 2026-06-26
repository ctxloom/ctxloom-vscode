import { describe, expect, it, vi } from "vitest";

// ltk-data.ts imports "vscode" at module scope (for the ltkPath/workspaceDir
// settings + cwd seams, mirroring cli.ts). That module only exists in the
// extension host, so stub it here — these tests exercise only the pure
// parse/build functions, which never touch the stub.
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({ get: () => undefined }),
    workspaceFolders: undefined,
  },
}));

import { buildEvaluatePayload, parseLtkDecision } from "./ltk-data.js";

describe("parseLtkDecision", () => {
  it("treats empty stdout as allow (ltk writes nothing on allow)", () => {
    expect(parseLtkDecision("")).toEqual({ allow: true });
    expect(parseLtkDecision("   \n ")).toEqual({ allow: true });
  });

  it("parses a deny with message and suggestion split on the marker", () => {
    // Exact shape observed from `ltk evaluate` (claude-code engine).
    const stdout = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "do not use rm directly\n\nUse instead: use trash-cli instead",
      },
    });
    expect(parseLtkDecision(stdout)).toEqual({
      allow: false,
      message: "do not use rm directly",
      suggestion: "use trash-cli instead",
    });
  });

  it("parses a deny with only a message (no suggestion marker)", () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "blocked by policy",
      },
    });
    expect(parseLtkDecision(stdout)).toEqual({
      allow: false,
      message: "blocked by policy",
    });
  });

  it("treats a non-deny decision as allow", () => {
    const stdout = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
    expect(parseLtkDecision(stdout)).toEqual({ allow: true });
  });

  it("does not throw on malformed JSON; treats it as allow", () => {
    expect(parseLtkDecision("not json at all")).toEqual({ allow: true });
    expect(parseLtkDecision("{ broken")).toEqual({ allow: true });
  });
});

describe("buildEvaluatePayload", () => {
  it("produces the claude-code hook payload shape for a shell command", () => {
    const payload = buildEvaluatePayload("rm -rf foo");
    expect(JSON.parse(payload)).toEqual({
      tool_name: "Bash",
      tool_input: { command: "rm -rf foo" },
    });
  });

  it("preserves the command verbatim, including quotes and spaces", () => {
    const cmd = `echo "a b" && ls`;
    const payload = buildEvaluatePayload(cmd);
    expect(JSON.parse(payload)).toEqual({
      tool_name: "Bash",
      tool_input: { command: cmd },
    });
  });
});
