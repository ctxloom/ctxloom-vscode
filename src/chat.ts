import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as vscode from "vscode";
import { binaryPath, listProfiles, spawnStreaming, workspaceDir } from "./cli";
import { renderMarkdown } from "./markdown";
import {
  OutboundQueue,
  buildRunArgs,
  encodeMessageLine,
  formatToolInput,
  lastStderrLine,
  parseChatEvent,
  truncate,
  wantsMarkdown,
  type ChatEntry,
  type WebviewEvent,
} from "./protocol";

// Tool input/output can be huge (a full file read, a long command output).
// Cap what the panel renders so one tool turn can't bloat the webview; the
// terminal run shows the untruncated version.
const TOOL_TEXT_MAX = 2000;

// Messages the extension posts to the webview: the parsed NDJSON events, a
// connection status line, the active profile label, and a reset (clear the log
// when the session is replaced).
type ToWebview =
  | WebviewEvent
  | { kind: "status"; text: string; connected: boolean }
  | { kind: "profile"; label: string }
  | { kind: "reset" };

// Messages the webview posts back.
type FromWebview =
  | { kind: "send"; text: string }
  | { kind: "selectProfile" }
  | { kind: "newSession" };

/**
 * A live chat session: owns a `ctxloom run --structured --format json`
 * subprocess paired with a webview panel. User input flows webview → stdin (one
 * line per message); the agent's structured turns flow stdout (NDJSON) → webview
 * as chat bubbles. It is the GUI sibling of the terminal `run --structured`
 * REPL, driving the same backend.
 *
 * One panel is reused (a singleton): opening chat again reveals the existing one.
 */
export class ChatSession {
  private static current: ChatSession | undefined;

  /**
   * Opens the chat panel, or reveals it if one already exists. An optional
   * profile (e.g. launched from the Profiles view) seeds a new panel with that
   * profile, or — if a panel is already open — switches it to that profile,
   * which starts a fresh session by design.
   */
  static open(
    context: vscode.ExtensionContext,
    profile?: { name: string; label: string },
  ): void {
    if (ChatSession.current) {
      ChatSession.current.panel.reveal(vscode.ViewColumn.Beside);
      if (profile) {
        ChatSession.current.switchProfile(profile.name, profile.label);
      }
      return;
    }
    if (!workspaceDir()) {
      void vscode.window.showErrorMessage(
        "ctxloom: open a folder before starting a chat.",
      );
      return;
    }
    ChatSession.current = new ChatSession(context, profile);
  }

  private readonly panel: vscode.WebviewPanel;
  private proc: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuf = "";
  // The profile the chat launches with. Seeded from the ctxloom.runProfile
  // setting; the profile picker overrides it for this panel's lifetime. Empty
  // means "let ctxloom use the project's default profiles".
  private activeProfile: string;
  // The backend-supplied display label for activeProfile, shown in the header.
  // Falls back to the raw profile string (or "default") before a pick resolves
  // it; the picker sets it from the profile's displayName.
  private activeProfileLabel: string;
  // When set, the current backend's exit should respawn a fresh session instead
  // of reporting "session ended" — used by the profile picker and New Session.
  private pendingRestart: { newSession: boolean } | undefined;
  // Serializes stdout-derived events so async markdown rendering can't reorder
  // turns: each event waits for the previous one's render+post to finish.
  private renderChain: Promise<void> = Promise.resolve();
  // Rolling tail of the subprocess's stderr. The backend reports real failures
  // here (e.g. "unknown flag: --structured", "warning: watch stream ended"),
  // so on a non-zero/early exit we can show the cause instead of a bare
  // "session ended". Capped so a chatty -vvv run can't grow it unbounded.
  private stderrTail = "";
  private disposed = false;
  // Outbound messages are never dropped: they are held until the backend's
  // stdin is writable, then flushed in order. The writer targets whichever
  // process is current, so a respawn (New Session) just retargets it.
  private readonly outbox = new OutboundQueue((line) => {
    this.proc?.stdin.write(line + "\n");
  });

  private constructor(
    context: vscode.ExtensionContext,
    profile?: { name: string; label: string },
  ) {
    // A profile passed in (launched from the Profiles view) wins; otherwise fall
    // back to the ctxloom.runProfile setting, and finally to the project default.
    this.activeProfile =
      profile?.name ??
      vscode.workspace.getConfiguration("ctxloom").get<string>("runProfile") ??
      "";
    this.activeProfileLabel = profile?.label || this.activeProfile || "default";
    this.panel = vscode.window.createWebviewPanel(
      "ctxloom.chat",
      "ctxloom chat",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = chatHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: FromWebview) => this.onWebviewMessage(msg),
      undefined,
      context.subscriptions,
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, context.subscriptions);

    this.start();
  }

  /** Spawns the structured run and wires its streams to the webview. */
  private start(opts: { newSession?: boolean } = {}): void {
    const args = buildRunArgs({
      structured: true,
      profile: this.activeProfile,
      newSession: opts.newSession,
    });
    this.post({ kind: "profile", label: this.activeProfileLabel });

    // Pre-flight an absolute binaryPath so a wrong/whitespaced path produces a
    // clear, quoted message rather than a bare async ENOENT. A bare name
    // (PATH lookup) can't be stat-checked here, so it's left to spawn.
    const bin = binaryPath();
    if (isAbsolute(bin) && !existsSync(bin)) {
      this.post({
        kind: "status",
        text: `ctxloom binary not found at "${bin}" — fix the ctxloom.binaryPath setting (check for a stray space)`,
        connected: false,
      });
      return;
    }

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawnStreaming(args);
    } catch (err) {
      this.post({
        kind: "status",
        text: `failed to start ctxloom: ${String(err)}`,
        connected: false,
      });
      return;
    }
    this.proc = proc;
    // The pipe accepts writes immediately; flush anything queued before now and
    // let later sends write through.
    this.outbox.setWritable(true);
    this.post({ kind: "status", text: "starting agent…", connected: true });

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    // Backend diagnostics ("ctxloom: starting session …") ride stderr; surface
    // them to the output channel rather than the chat transcript.
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      console.error("ctxloom chat:", chunk);
      // Keep the last ~4KB so an early exit can surface the backend's own error.
      this.stderrTail = (this.stderrTail + chunk).slice(-4096);
    });

    proc.on("error", (err) =>
      this.post({
        kind: "status",
        text: `agent process error (binary "${bin}"): ${err.message}`,
        connected: false,
      }),
    );
    proc.on("exit", (code, signal) => {
      this.proc = undefined;
      // Hold any further sends until a new backend is running, rather than
      // writing into a dead pipe.
      this.outbox.setWritable(false);
      if (this.disposed) {
        return;
      }
      // An intentional restart (profile switch / New Session): clear the panel
      // and spawn a fresh backend instead of reporting the exit as an ending.
      if (this.pendingRestart) {
        const restart = this.pendingRestart;
        this.pendingRestart = undefined;
        this.stdoutBuf = "";
        this.stderrTail = "";
        this.resetPanel();
        this.start({ newSession: restart.newSession });
        return;
      }
      // Distinguish a clean end from a failure, and attach the backend's last
      // stderr so a misconfigured binary or backend error is diagnosable from
      // the panel rather than appearing as an opaque "session ended".
      const how =
        signal != null
          ? `killed by ${signal}`
          : code === 0
            ? "session ended"
            : `session ended (exit ${code ?? "?"})`;
      const detail = lastStderrLine(this.stderrTail);
      this.post({
        kind: "status",
        text: detail ? `${how} — ${detail}` : how,
        connected: false,
      });
    });
  }

  /** Buffers stdout and dispatches each complete NDJSON line. */
  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    for (let nl = this.stdoutBuf.indexOf("\n"); nl >= 0; nl = this.stdoutBuf.indexOf("\n")) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (line) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    const ev = parseChatEvent(line);
    if (!ev) {
      return;
    }
    if (ev.kind === "entry") {
      this.enrichToolEntry(ev.entry);
    }
    // Render + post through a serial chain so an entry awaiting markdown can't be
    // overtaken by a later event (a following tool turn, or the completion rule).
    this.renderChain = this.renderChain.then(async () => {
      if (ev.kind === "entry" && ev.entry.content && wantsMarkdown(ev.entry.type)) {
        ev.entry.html = await renderMarkdown(ev.entry.content);
      }
      this.post(ev);
    });
  }

  /**
   * Fills a tool entry's display-ready, truncated input/output text so the
   * webview can show details without re-implementing formatting. Non-tool
   * entries are left untouched.
   */
  private enrichToolEntry(entry: ChatEntry): void {
    if (entry.type === "tool_use") {
      const text = formatToolInput(entry.toolInput);
      if (text) {
        entry.toolInputText = truncate(text, TOOL_TEXT_MAX);
      }
    } else if (entry.type === "tool_result" && entry.toolOutput) {
      entry.toolOutputText = truncate(entry.toolOutput, TOOL_TEXT_MAX);
    }
  }

  private onWebviewMessage(msg: FromWebview): void {
    if (msg.kind === "selectProfile") {
      void this.selectProfile();
      return;
    }
    if (msg.kind === "newSession") {
      this.restart({ newSession: true });
      return;
    }
    // One line = one message. Queue it: the OutboundQueue delivers it now if the
    // backend is up, or holds it (in order) until a backend is running again —
    // so messages typed mid-turn or during a respawn are never lost.
    this.outbox.enqueue(encodeMessageLine(msg.text));
  }

  /** Opens the profile picker on the active chat panel, if any. */
  static selectProfile(): void {
    void ChatSession.current?.selectProfile();
  }

  /** Starts a fresh session on the active chat panel, if any. */
  static newSession(): void {
    ChatSession.current?.restart({ newSession: true });
  }

  /**
   * Prompts for a profile and, if one is chosen, restarts the chat on a fresh
   * backend running it. Switching profile is a new session by design.
   */
  private async selectProfile(): Promise<void> {
    let profiles;
    try {
      profiles = await listProfiles();
    } catch (err) {
      void vscode.window.showErrorMessage(`ctxloom: could not list profiles: ${String(err)}`);
      return;
    }
    const items = profiles.map((p) => ({
      label: p.displayName,
      description: [p.isDefault ? "default" : "", p.isRemote ? "remote" : ""]
        .filter((s) => s !== "")
        .join(" · "),
      detail: p.description,
      profileName: p.name,
      profileLabel: p.displayName,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a profile — starts a new chat session",
      matchOnDetail: true,
    });
    if (!pick) {
      return;
    }
    this.switchProfile(pick.profileName, pick.profileLabel);
  }

  /**
   * Switches the panel to a different profile and restarts its backend on a fresh
   * session. Switching profile is a new session by design — the assembled context
   * differs, so continuing the old transcript would be incoherent.
   */
  private switchProfile(name: string, label: string): void {
    this.activeProfile = name;
    this.activeProfileLabel = label;
    this.restart({ newSession: true });
  }

  /**
   * Replaces the current backend with a fresh one. Kills the running process and
   * lets its exit handler — seeing pendingRestart — clear the panel and respawn,
   * so there is never more than one live backend at a time.
   */
  private restart(opts: { newSession: boolean }): void {
    this.pendingRestart = opts;
    if (this.proc) {
      this.proc.kill();
    } else {
      this.pendingRestart = undefined;
      this.stdoutBuf = "";
      this.stderrTail = "";
      this.resetPanel();
      this.start({ newSession: opts.newSession });
    }
  }

  /**
   * Clears the panel, but only after any in-flight turn renders have posted, so a
   * late markdown render from the old session can't leak into the fresh one.
   */
  private resetPanel(): void {
    this.renderChain = this.renderChain.then(() => this.post({ kind: "reset" }));
  }

  private post(msg: ToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    this.disposed = true;
    this.outbox.setWritable(false);
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = undefined;
    ChatSession.current = undefined;
  }
}

/** Builds the chat webview HTML with a CSP locked to a per-load nonce. */
function chatHtml(): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    // Rendered markdown carries its own class-based markup (no inline styles) but
    // can include images and links; allow https/data images. Scripts stay locked
    // to the per-load nonce so injected markdown HTML can't execute.
    `style-src 'nonce-${nonce}'`,
    `img-src https: data:`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex; flex-direction: column; height: 100vh;
  }
  #log { flex: 1 1 auto; overflow-y: auto; padding: 12px; }
  .turn { margin: 6px 0; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-wrap: break-word; }
  .user { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); }
  .assistant { background: var(--vscode-editorWidget-background); }
  .system { opacity: 0.75; font-style: italic; }
  /* Extended-thinking / reasoning prose: subdued and italic so it reads as
     secondary to the answer. A future setting will toggle these on/off. */
  .thinking { opacity: 0.6; font-style: italic; background: transparent; border-left: 3px solid var(--vscode-descriptionForeground, #888); }
  .tool { font-family: var(--vscode-editor-font-family); font-size: 0.9em; opacity: 0.85; }
  .tool.err { color: var(--vscode-errorForeground); }
  .tool details > summary { cursor: pointer; list-style: revert; }
  .tool pre.tool-detail {
    margin: 6px 0 0; padding: 6px 8px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
    border-radius: 4px; white-space: pre-wrap; word-break: break-word;
    max-height: 24em; overflow: auto;
  }
  .role { font-size: 0.75em; text-transform: uppercase; opacity: 0.6; margin-bottom: 2px; }
  /* Rendered-markdown body: normal whitespace (the markup carries structure) and
     compact margins so a turn doesn't waste vertical space. */
  .md { white-space: normal; }
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md p { margin: 0.4em 0; }
  .md ul, .md ol { margin: 0.4em 0; padding-left: 1.4em; }
  .md a { color: var(--vscode-textLink-foreground); }
  .md code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
  .md pre {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12));
    padding: 8px; border-radius: 4px; overflow: auto;
  }
  .md pre code { font-size: 0.9em; }
  .md table { border-collapse: collapse; }
  .md th, .md td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; }
  .time { opacity: 0.6; font-variant-numeric: tabular-nums; margin-left: 6px; }
  .boundary { border-top: 1px solid var(--vscode-panel-border); margin: 12px 0; }
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .toolbtn {
    color: var(--vscode-foreground);
    background: transparent;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px; padding: 2px 8px; font-size: 0.8em; cursor: pointer;
  }
  .toolbtn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
  #header { padding: 4px 12px; font-size: 0.8em; opacity: 0.8; border-bottom: 1px solid var(--vscode-panel-border); }
  #header:empty { display: none; }
  #meta { padding: 4px 12px; font-size: 0.8em; opacity: 0.7; font-family: var(--vscode-editor-font-family); }
  #meta:empty { display: none; }
  #status { padding: 4px 12px; font-size: 0.8em; opacity: 0.7; border-top: 1px solid var(--vscode-panel-border); }
  #composer { display: flex; padding: 8px; gap: 8px; border-top: 1px solid var(--vscode-panel-border); }
  #input {
    flex: 1 1 auto; resize: none; min-height: 2.4em; max-height: 12em;
    font-family: inherit; font-size: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px; padding: 6px;
  }
  #send {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none; border-radius: 4px; padding: 0 14px; cursor: pointer;
  }
  #send:hover { background: var(--vscode-button-hoverBackground); }
  #send:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="profileBtn" class="toolbtn" title="Switch profile (starts a new session)">Profile: …</button>
    <button id="newSessionBtn" class="toolbtn" title="Start a fresh session on a new backend">New Session</button>
  </div>
  <div id="header"></div>
  <div id="log"></div>
  <div id="meta"></div>
  <div id="status">connecting…</div>
  <div id="composer">
    <textarea id="input" rows="1" placeholder="Message the agent — Enter to send, Shift+Enter for a new line"></textarea>
    <button id="send">Send</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const header = document.getElementById('header');
  const log = document.getElementById('log');
  const meta = document.getElementById('meta');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const status = document.getElementById('status');
  const profileBtn = document.getElementById('profileBtn');
  const newSessionBtn = document.getElementById('newSessionBtn');

  profileBtn.addEventListener('click', () => vscode.postMessage({ kind: 'selectProfile' }));
  newSessionBtn.addEventListener('click', () => vscode.postMessage({ kind: 'newSession' }));

  // Clears the transcript and per-session info when the backend is replaced.
  function reset() {
    log.replaceChildren();
    header.textContent = '';
    meta.textContent = '';
  }

  function scroll() { log.scrollTop = log.scrollHeight; }

  function fmtTime(at) {
    const d = at ? new Date(at) : new Date();
    return d.toLocaleTimeString();
  }

  // Appends a dimmed time label to a node; at is the protocol's epoch-ms stamp.
  function withTime(node, at) {
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = fmtTime(at);
    node.appendChild(t);
  }

  // A tool turn: a one-line summary, plus a collapsible detail pane when the
  // extension supplied input/output text.
  function renderTool(div, summaryText, detailText, at, isErr) {
    div.className = 'turn tool' + (isErr ? ' err' : '');
    if (detailText) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = summaryText;
      withTime(sum, at);
      det.appendChild(sum);
      const pre = document.createElement('pre');
      pre.className = 'tool-detail';
      pre.textContent = detailText;
      det.appendChild(pre);
      div.appendChild(det);
    } else {
      div.textContent = summaryText;
      withTime(div, at);
    }
  }

  function addTurn(entry, at) {
    const type = entry.type || 'assistant';
    const div = document.createElement('div');
    if (type === 'tool_use') {
      renderTool(div, '→ ' + (entry.toolName || 'tool'), entry.toolInputText, at, false);
    } else if (type === 'tool_result') {
      renderTool(
        div,
        (entry.isError ? '✗ ' : '✓ ') + (entry.toolName || 'tool'),
        entry.toolOutputText,
        at,
        entry.isError,
      );
    } else if (type === 'thinking') {
      // claude-code blanks the reasoning text (see chat_stream.go), so content is
      // usually empty — show a marker that the model reasoned this turn. Real prose
      // renders inline if a backend ever provides it. A future setting will toggle
      // these on/off.
      div.className = 'turn thinking';
      div.textContent = entry.content
        ? '💭 ' + entry.content
        : '💭 reasoned (thinking hidden by claude-code)';
      withTime(div, at);
    } else {
      div.className = 'turn ' + type;
      const role = document.createElement('div');
      role.className = 'role';
      role.textContent = type;
      withTime(role, at);
      div.appendChild(role);
      const body = document.createElement('div');
      // entry.html is VS Code's sanitized markdown render; scripts are inert
      // under the webview CSP. Markdown wants normal whitespace; plain text keeps
      // the turn's pre-wrap so newlines survive. Fall back to text when absent.
      if (entry.html) {
        body.className = 'md';
        body.innerHTML = entry.html;
      } else {
        body.textContent = entry.content || '';
      }
      div.appendChild(body);
    }
    log.appendChild(div);
    scroll();
  }

  function fmtCount(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  // A completed response: rule off the turn and refresh the persistent context
  // gauge / cost / timing bar from the turn's accounting.
  function addComplete(c) {
    const hr = document.createElement('div');
    hr.className = 'boundary';
    log.appendChild(hr);
    scroll();
    const parts = [];
    if (c.contextWindow) parts.push('context ' + fmtCount(c.inputTokens || 0) + '/' + fmtCount(c.contextWindow));
    if (typeof c.costUsd === 'number') parts.push('$' + c.costUsd.toFixed(4));
    if (c.durationMs) parts.push((c.durationMs / 1000).toFixed(1) + 's');
    if (c.model) parts.push(c.model);
    meta.textContent = parts.join(' · ');
  }

  // One-time session info: model + MCP server statuses in the header.
  function setSession(s) {
    const mcp = (s.mcpServers || []).map((m) => m.name + '(' + m.status + ')').join(', ');
    header.textContent = (s.model || '') + (mcp ? ' · mcp: ' + mcp : '');
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.kind === 'entry') addTurn(msg.entry, msg.at);
    else if (msg.kind === 'complete') addComplete(msg.complete);
    else if (msg.kind === 'session') setSession(msg.session);
    else if (msg.kind === 'profile') profileBtn.textContent = 'Profile: ' + msg.label;
    else if (msg.kind === 'reset') reset();
    else if (msg.kind === 'status') {
      status.textContent = msg.text;
      send.disabled = !msg.connected;
      input.disabled = !msg.connected;
    }
  });

  function submit() {
    const text = input.value;
    if (!text.trim() || send.disabled) return;
    // Echo the user's message locally; the backend's transcript will also carry
    // it, but immediate feedback matters more than dedupe here.
    addTurn({ type: 'user', content: text });
    vscode.postMessage({ kind: 'send', text });
    input.value = '';
    autosize();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 192) + 'px';
  }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  send.addEventListener('click', submit);
</script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
