import * as vscode from "vscode";
import { listProfiles } from "./cli";
import { openContent } from "./content-actions";
import {
  bundleLabel,
  bundleSource,
  listFragments,
  listPrompts,
  type ContentKind,
} from "./content-data";
import {
  addBundle,
  addParent,
  excludeFragment,
  getProfileDetail,
  includeFragment,
  removeBundle,
  removeParent,
  resolveProfile,
  setDescription,
  setLlm,
  type ProfileDetail,
  type ResolvedAssembly,
} from "./profile-data";
import { listRemotes } from "./remotes-data";

// The Profile Composer: a webview editor for assembling a profile. You author
// the *declared* config (parents for inheritance, included bundles/fragments,
// exclusions, llm/description) on the left/right, and the *resolved* assembly —
// the fully inheritance-resolved fragment set ctxloom would load — previews live
// at the bottom. Every edit applies immediately via `profile modify`.

interface AvailableItem {
  ref: string;
  name: string;
  kind: ContentKind;
}
interface AvailableBundle {
  ref: string;
  label: string;
  items: AvailableItem[];
}
interface AvailableSource {
  label: string;
  bundles: AvailableBundle[];
}

interface LoadedPayload {
  kind: "loaded";
  detail: ProfileDetail;
  available: AvailableSource[];
  resolved: ResolvedAssembly;
  tokenEstimate: number;
}
type ToWebview = LoadedPayload | { kind: "status"; text: string };

type FromWebview =
  | { kind: "addBundle"; ref: string }
  | { kind: "removeBundle"; ref: string }
  | { kind: "addParent" }
  | { kind: "removeParent"; parent: string }
  | { kind: "excludeFragment"; fragment: string }
  | { kind: "includeFragment"; fragment: string }
  | { kind: "editLlm" }
  | { kind: "editDescription" }
  | { kind: "open"; ref: string; contentKind: ContentKind }
  | { kind: "refresh" };

/** A composer webview per profile; reused (revealed) if already open. */
export class ProfileComposer {
  private static readonly open = new Map<string, ProfileComposer>();

  /** Opens (or reveals) the composer for the named profile. */
  static show(context: vscode.ExtensionContext, profile: string): void {
    const existing = ProfileComposer.open.get(profile);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    ProfileComposer.open.set(profile, new ProfileComposer(context, profile));
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    context: vscode.ExtensionContext,
    private readonly profile: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "ctxloom.profileComposer",
      `Compose: ${profile}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = composerHtml();
    this.panel.webview.onDidReceiveMessage(
      (msg: FromWebview) => void this.onMessage(msg),
      undefined,
      context.subscriptions,
    );
    this.panel.onDidDispose(
      () => ProfileComposer.open.delete(profile),
      undefined,
      context.subscriptions,
    );
    void this.reload();
  }

  private post(msg: ToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  /** Re-reads the declared config + resolved assembly + available content. */
  private async reload(): Promise<void> {
    this.post({ kind: "status", text: "loading…" });
    try {
      const [detail, resolved, available] = await Promise.all([
        getProfileDetail(this.profile),
        resolveProfile(this.profile),
        this.buildAvailable(),
      ]);
      this.post({
        kind: "loaded",
        detail,
        available,
        resolved,
        tokenEstimate: Math.ceil(resolved.context.length / 4),
      });
    } catch (err) {
      this.post({ kind: "status", text: `error: ${String(err)}` });
    }
  }

  /** The selectable content, grouped source → bundle → fragments/prompts. */
  private async buildAvailable(): Promise<AvailableSource[]> {
    const [fragments, prompts, remotes] = await Promise.all([
      listFragments(),
      listPrompts(),
      listRemotes().catch(() => []),
    ]);
    const remoteName = new Map(remotes.map((r) => [r.url, r.name]));
    const entries: { ref: string; name: string; bundle: string; kind: ContentKind }[] = [
      ...fragments.map((f) => ({ ref: f.ref, name: f.name, bundle: f.bundle, kind: "fragments" as const })),
      ...prompts.map((p) => ({ ref: p.ref, name: p.name, bundle: p.bundle, kind: "prompts" as const })),
    ];

    const bySource = new Map<string, Map<string, AvailableItem[]>>();
    for (const e of entries) {
      const source = bundleSource(e.bundle);
      const bundles = bySource.get(source) ?? new Map<string, AvailableItem[]>();
      const items = bundles.get(e.bundle) ?? [];
      items.push({ ref: e.ref, name: e.name, kind: e.kind });
      bundles.set(e.bundle, items);
      bySource.set(source, bundles);
    }

    return [...bySource.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([source, bundles]) => ({
        label: remoteName.get(source) ?? source,
        bundles: [...bundles.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([ref, items]) => ({ ref, label: bundleLabel(ref), items })),
      }));
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    switch (msg.kind) {
      case "refresh":
        await this.reload();
        return;
      case "open":
        await openContent(msg.ref, msg.contentKind);
        return;
      case "addParent": {
        const parent = await this.pickParent();
        if (parent) {
          await this.apply(() => addParent(this.profile, parent));
        }
        return;
      }
      case "editLlm": {
        const llm = await vscode.window.showInputBox({
          prompt: "Preferred LLM label (empty clears it)",
        });
        if (llm !== undefined) {
          await this.apply(() => setLlm(this.profile, llm.trim()));
        }
        return;
      }
      case "editDescription": {
        const desc = await vscode.window.showInputBox({ prompt: "Profile description" });
        if (desc !== undefined) {
          await this.apply(() => setDescription(this.profile, desc));
        }
        return;
      }
      case "addBundle":
        await this.apply(() => addBundle(this.profile, msg.ref));
        return;
      case "removeBundle":
        await this.apply(() => removeBundle(this.profile, msg.ref));
        return;
      case "removeParent":
        await this.apply(() => removeParent(this.profile, msg.parent));
        return;
      case "excludeFragment":
        await this.apply(() => excludeFragment(this.profile, msg.fragment));
        return;
      case "includeFragment":
        await this.apply(() => includeFragment(this.profile, msg.fragment));
        return;
    }
  }

  /** Applies a mutation, then reloads so the resolved preview stays truthful. */
  private async apply(mutate: () => Promise<void>): Promise<void> {
    this.post({ kind: "status", text: "updating…" });
    try {
      await mutate();
    } catch (err) {
      void vscode.window.showErrorMessage(`ctxloom: ${String(err)}`);
    }
    await this.reload();
  }

  /** Prompts for another profile to add as a parent (excludes this one). */
  private async pickParent(): Promise<string | undefined> {
    const profiles = await listProfiles();
    const items = profiles
      .filter((p) => p.name !== this.profile)
      .map((p) => ({ label: p.displayName, description: p.isRemote ? "remote" : "", name: p.name }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Add a parent profile to inherit from",
    });
    return pick?.name;
  }
}

/** Builds the composer webview HTML with a CSP locked to a per-load nonce. */
function composerHtml(): string {
  const nonce = makeNonce();
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
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
  body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
    display: flex; flex-direction: column; height: 100vh; }
  button { font-family: inherit; font-size: 0.85em; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
    border: none; border-radius: 4px; padding: 1px 7px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.link { background: transparent; color: var(--vscode-textLink-foreground); padding: 0; }
  #head { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  #head h2 { margin: 0 0 4px; font-size: 1.1em; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; }
  .muted { opacity: 0.7; }
  .chip { display: inline-flex; gap: 4px; align-items: center; padding: 1px 8px; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 0.85em; }
  .chip button { background: transparent; color: inherit; padding: 0 2px; }
  #cols { flex: 1 1 auto; display: flex; min-height: 0; }
  .col { flex: 1 1 50%; overflow-y: auto; padding: 8px 12px; }
  .col + .col { border-left: 1px solid var(--vscode-panel-border); }
  h3 { font-size: 0.8em; text-transform: uppercase; opacity: 0.6; margin: 4px 0; }
  #search { width: 100%; box-sizing: border-box; margin-bottom: 6px; padding: 4px 6px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; }
  details { margin: 2px 0; } summary { cursor: pointer; }
  .item, .inc { display: flex; align-items: center; gap: 6px; padding: 1px 0 1px 14px; }
  .item .name { flex: 1 1 auto; }
  .kind { font-size: 0.75em; opacity: 0.5; }
  .inc { padding-left: 0; }
  .inc .label { flex: 1 1 auto; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  #resolved { border-top: 1px solid var(--vscode-panel-border); padding: 6px 12px; max-height: 30vh; overflow-y: auto; }
  #resolved pre { white-space: pre-wrap; font-size: 0.85em; }
  #status { padding: 3px 12px; font-size: 0.8em; opacity: 0.7; border-top: 1px solid var(--vscode-panel-border); }
  code { font-family: var(--vscode-editor-font-family); }
</style>
</head>
<body>
  <div id="head">
    <h2 id="title">Profile</h2>
    <div class="row"><span class="muted">description:</span> <span id="desc"></span>
      <button class="link" id="editDesc">edit</button></div>
    <div class="row"><span class="muted">llm:</span> <span id="llm"></span>
      <button class="link" id="editLlm">edit</button></div>
    <div class="row"><span class="muted">parents:</span> <span id="parents"></span>
      <button id="addParent">+ parent</button></div>
  </div>
  <div id="cols">
    <div class="col">
      <h3>Available — fragments &amp; prompts</h3>
      <input id="search" placeholder="filter…" />
      <div id="available"></div>
    </div>
    <div class="col">
      <h3>Included (declared)</h3>
      <div id="included"></div>
      <h3 id="exHead">Excluded fragments</h3>
      <div id="excluded"></div>
    </div>
  </div>
  <div id="resolved"></div>
  <div id="status">loading…</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let model = null;

  $('editDesc').onclick = () => vscode.postMessage({ kind: 'editDescription' });
  $('editLlm').onclick = () => vscode.postMessage({ kind: 'editLlm' });
  $('addParent').onclick = () => vscode.postMessage({ kind: 'addParent' });
  $('search').addEventListener('input', () => renderAvailable());

  function chip(text, onRemove) {
    const s = document.createElement('span'); s.className = 'chip';
    s.appendChild(document.createTextNode(text));
    const b = document.createElement('button'); b.textContent = '✕'; b.title = 'remove';
    b.onclick = onRemove; s.appendChild(b);
    return s;
  }

  // Split a ref into a readable label: "bundle · name" for a specific
  // fragment/prompt ref, else the bundle's short name.
  function refLabel(ref) {
    const hash = ref.indexOf('#');
    if (hash < 0) return bundleShort(ref);
    const bundle = ref.slice(0, hash);
    const tail = ref.slice(hash + 1).replace(/^(fragments|prompts)\\//, '');
    return bundleShort(bundle) + ' · ' + tail;
  }
  function bundleShort(b) { const i = b.lastIndexOf('@bundles/'); return i >= 0 ? b.slice(i + 9) : b; }

  function renderHead() {
    $('title').textContent = model.detail.name + (model.detail.isDefault ? '  (default)' : '');
    $('desc').textContent = model.detail.description || '(none)';
    $('llm').textContent = model.detail.llm || '(default)';
    const p = $('parents'); p.replaceChildren();
    if (model.detail.parents.length === 0) p.appendChild(Object.assign(document.createElement('span'), { className: 'muted', textContent: '(none)' }));
    for (const parent of model.detail.parents) p.appendChild(chip(parent, () => vscode.postMessage({ kind: 'removeParent', parent })));
  }

  function renderIncluded() {
    const inc = $('included'); inc.replaceChildren();
    if (model.detail.bundles.length === 0) inc.appendChild(Object.assign(document.createElement('div'), { className: 'muted', textContent: 'Nothing added here yet — add from the left.' }));
    for (const ref of model.detail.bundles) {
      const row = document.createElement('div'); row.className = 'inc';
      const l = document.createElement('span'); l.className = 'label'; l.textContent = refLabel(ref); l.title = ref;
      const rm = document.createElement('button'); rm.textContent = 'remove';
      rm.onclick = () => vscode.postMessage({ kind: 'removeBundle', ref });
      row.append(l, rm); inc.appendChild(row);
    }
    const ex = $('excluded'); ex.replaceChildren();
    $('exHead').style.display = model.detail.excludeFragments.length ? '' : 'none';
    for (const f of model.detail.excludeFragments) {
      const row = document.createElement('div'); row.className = 'inc';
      const l = document.createElement('span'); l.className = 'label'; l.textContent = f;
      const un = document.createElement('button'); un.textContent = 'un-exclude';
      un.onclick = () => vscode.postMessage({ kind: 'includeFragment', fragment: f });
      row.append(l, un); ex.appendChild(row);
    }
  }

  function renderAvailable() {
    if (!model) return;
    const q = $('search').value.toLowerCase();
    const root = $('available'); root.replaceChildren();
    for (const src of model.available) {
      const sd = document.createElement('details'); sd.open = true;
      const ss = document.createElement('summary'); ss.textContent = src.label; sd.appendChild(ss);
      let shownInSrc = 0;
      for (const b of src.bundles) {
        const items = b.items.filter((i) => !q || i.name.toLowerCase().includes(q) || b.label.toLowerCase().includes(q));
        if (items.length === 0) continue;
        shownInSrc += items.length;
        const bd = document.createElement('details'); bd.open = !!q;
        const bs = document.createElement('summary');
        bs.textContent = b.label + ' ';
        const addB = document.createElement('button'); addB.textContent = '+ bundle';
        addB.onclick = (e) => { e.preventDefault(); vscode.postMessage({ kind: 'addBundle', ref: b.ref }); };
        bs.appendChild(addB); bd.appendChild(bs);
        for (const it of items) {
          const row = document.createElement('div'); row.className = 'item';
          const add = document.createElement('button'); add.textContent = '+';
          add.title = 'add ' + it.ref;
          add.onclick = () => vscode.postMessage({ kind: 'addBundle', ref: it.ref });
          const name = document.createElement('span'); name.className = 'name';
          const link = document.createElement('button'); link.className = 'link'; link.textContent = it.name;
          link.onclick = () => vscode.postMessage({ kind: 'open', ref: it.ref, contentKind: it.kind });
          name.appendChild(link);
          const k = document.createElement('span'); k.className = 'kind'; k.textContent = it.kind === 'fragments' ? 'frag' : 'prompt';
          row.append(add, name, k); bd.appendChild(row);
        }
        sd.appendChild(bd);
      }
      if (shownInSrc > 0) root.appendChild(sd);
    }
  }

  function renderResolved() {
    const r = $('resolved'); r.replaceChildren();
    const h = document.createElement('div');
    h.innerHTML = '<strong>Resolved</strong> — ' + model.resolved.fragments.length + ' fragments · ~' +
      (model.tokenEstimate >= 1000 ? (model.tokenEstimate / 1000).toFixed(1) + 'k' : model.tokenEstimate) + ' tokens';
    r.appendChild(h);
    const list = document.createElement('details');
    const sum = document.createElement('summary'); sum.textContent = 'fragments'; list.appendChild(sum);
    for (const f of model.resolved.fragments) {
      const d = document.createElement('div'); d.className = 'item'; d.textContent = refLabel(f); d.title = f;
      list.appendChild(d);
    }
    r.appendChild(list);
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.kind === 'status') { $('status').textContent = msg.text; return; }
    if (msg.kind === 'loaded') {
      model = msg;
      renderHead(); renderIncluded(); renderAvailable(); renderResolved();
      $('status').textContent = model.detail.path;
    }
  });
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
