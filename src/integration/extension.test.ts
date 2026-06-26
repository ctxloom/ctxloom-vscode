import * as assert from "node:assert";
import * as vscode from "vscode";

// Integration tests run inside a real (headless) VS Code via @vscode/test-electron.
// They exercise the extension's *wiring* against the real API — activation,
// command/view registration, and that every provider command runs without
// throwing — which the vitest unit tests (pure logic only) cannot cover.

const EXT_ID = "ctxloom.ctxloom";

/** The extension under test; fails the suite early if it isn't present. */
function extension(): vscode.Extension<unknown> {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `extension ${EXT_ID} not found`);
  return ext;
}

interface ContributedCommand {
  command: string;
}
interface ContributedView {
  id: string;
}

describe("activation & contributions", () => {
  before(async () => {
    await extension().activate();
  });

  it("activates", () => {
    assert.ok(extension().isActive, "extension should be active");
  });

  it("registers every contributed command", async () => {
    const pkg = extension().packageJSON;
    const declared: string[] = (pkg.contributes.commands as ContributedCommand[]).map(
      (c) => c.command,
    );
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((id) => !registered.has(id));
    assert.deepStrictEqual(missing, [], `unregistered commands: ${missing.join(", ")}`);
  });

  it("contributes the ctxloom view container and all views", () => {
    const pkg = extension().packageJSON;
    const views: string[] = (pkg.contributes.views.ctxloom as ContributedView[]).map((v) => v.id);
    // Top-level views, plus the composite Config view that nests Profiles /
    // Fragments / Prompts / Remotes / ltk.
    const expected = ["ctxloom.sessions", "ctxloom.plans", "ctxloom.tasks", "ctxloom.config"];
    for (const id of expected) {
      assert.ok(views.includes(id), `missing view: ${id}`);
    }
  });
});

describe("tree views refresh without throwing", () => {
  // The refresh command for each view forces its TreeDataProvider to register
  // and (for some) re-query. The data backends may be absent in the test host,
  // but every provider catches failures and returns [], so refresh must resolve.
  const refreshers = [
    "ctxloom.sessions.refresh",
    "ctxloom.plans.refresh",
    "ctxloom.tasks.refresh",
    "ctxloom.config.refresh",
    "ctxloom.profiles.refresh",
    "ctxloom.fragments.refresh",
    "ctxloom.prompts.refresh",
    "ctxloom.remotes.refresh",
    "ctxloom.ltk.refresh",
  ];
  for (const id of refreshers) {
    it(id, async () => {
      await vscode.commands.executeCommand(id);
    });
  }
});

describe("chat", () => {
  before(async () => {
    await extension().activate();
    // Point the chat at a harmless binary so opening it doesn't launch a real
    // agent: `true` ignores args and exits 0, so the panel opens and the session
    // ends immediately. We only assert the panel is created here.
    await vscode.workspace
      .getConfiguration("ctxloom")
      .update("binaryPath", "true", vscode.ConfigurationTarget.Workspace);
  });

  it("opens a webview tab", async () => {
    await vscode.commands.executeCommand("ctxloom.openChat");
    const opened = await waitFor(() =>
      vscode.window.tabGroups.all.some((g) =>
        g.tabs.some((t) => t.label.toLowerCase().includes("ctxloom chat")),
      ),
    );
    assert.ok(opened, "a 'ctxloom chat' webview tab should be open");
  });
});

describe("profile composer", () => {
  it("opens a Compose webview tab", async () => {
    await extension().activate();
    // The command takes the selected profile item; a minimal stand-in suffices.
    await vscode.commands.executeCommand("ctxloom.profiles.compose", {
      profile: { name: "ts-dev" },
    });
    const opened = await waitFor(() =>
      vscode.window.tabGroups.all.some((g) =>
        g.tabs.some((t) => t.label.startsWith("Compose:")),
      ),
    );
    assert.ok(opened, "a 'Compose:' webview tab should open");
  });
});

/** Polls predicate up to ~2s; resolves true once it holds, false on timeout. */
async function waitFor(predicate: () => boolean): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}
