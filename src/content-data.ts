// Pure parsing + the backend seam for ctxloom's content listings (fragments and
// prompts), which share an identical shape: `<kind> list --format json` returns
// an array of { Name, Tags, Bundle }, and `<kind> show <ref>` prints the item's
// content. parseContentList is vscode-free and unit-tested; the list/show
// wrappers reach the backend through the transport() seam (transport.ts is
// vscode-free, so this module — and its parser tests — load under vitest). The
// fragments and prompts tree views both build on this so the two near-identical
// slices don't diverge.

import { transport } from "./transport";

/** Whether a content listing is the fragment set or the prompt set. Drives both
 * the subcommand (`fragment` vs `prompt`) and the ref's path segment. */
export type ContentKind = "fragments" | "prompts";

/**
 * One row in a content listing. `ref` is the fully-qualified reference passed to
 * `<kind> show` and to assemble-style commands, built as `${bundle}#${kind}/${name}`
 * (e.g. `…@bundles/default#fragments/communication`).
 */
export interface ContentItem {
  name: string;
  tags: string[];
  bundle: string;
  ref: string;
}

interface RawContentItem {
  name?: unknown;
  tags?: unknown;
  bundle?: unknown;
  ref?: unknown;
}

/** Maps a kind to its `ctxloom` subcommand (singular). */
function subcommand(kind: ContentKind): "fragment" | "prompt" {
  return kind === "fragments" ? "fragment" : "prompt";
}

const BUNDLE_MARKER = "@bundles/";

/**
 * A short, human label for a bundle reference used to group the tree: the
 * segment after "@bundles/" (e.g. "code-quality") for a remote bundle ref, else
 * the bundle string unchanged. Display-only.
 */
export function bundleLabel(bundle: string): string {
  const idx = bundle.lastIndexOf(BUNDLE_MARKER);
  return idx >= 0 ? bundle.slice(idx + BUNDLE_MARKER.length) : bundle;
}

/**
 * The source a bundle reference belongs to — the part before "@bundles/", which
 * for a remote bundle is exactly the remote's URL (e.g.
 * "https://github.com/ctxloom/ctxloom-default"). Lets content be grouped under
 * the remote it came from. Returns the whole ref when there is no marker.
 */
export function bundleSource(bundle: string): string {
  const idx = bundle.lastIndexOf(BUNDLE_MARKER);
  return idx >= 0 ? bundle.slice(0, idx) : bundle;
}

/**
 * Parses the JSON array emitted by `ctxloom <kind> list --format json` into
 * ContentItems. The backend supplies snake_case fields and a ready-made `ref`
 * (so the extension no longer reconstructs it). Entries without a string `name`
 * are skipped; `tags` is filtered to strings and deduped (the CLI can emit
 * repeats); `bundle`/`ref` default to empty when absent. Throws on output that
 * isn't a JSON array so the caller can surface a clear error.
 */
export function parseContentList(stdout: string, kind: ContentKind): ContentItem[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error(`expected a JSON array from \`ctxloom ${subcommand(kind)} list --format json\``);
  }
  const items: ContentItem[] = [];
  for (const entry of parsed) {
    const raw = entry as RawContentItem;
    if (typeof raw.name !== "string") {
      continue;
    }
    const name = raw.name;
    const bundle = typeof raw.bundle === "string" ? raw.bundle : "";
    const ref = typeof raw.ref === "string" ? raw.ref : `${bundle}#${kind}/${name}`;
    items.push({ name, tags: dedupeTags(raw.tags), bundle, ref });
  }
  return items;
}

/** Keeps only string tags, in first-seen order, without duplicates. */
function dedupeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (typeof tag === "string" && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/** Lists fragments via `fragment list --format json`. */
export async function listFragments(): Promise<ContentItem[]> {
  const { stdout } = await transport().exec(["fragment", "list", "--format", "json"]);
  return parseContentList(stdout, "fragments");
}

/** Lists prompts via `prompt list --format json`. */
export async function listPrompts(): Promise<ContentItem[]> {
  const { stdout } = await transport().exec(["prompt", "list", "--format", "json"]);
  return parseContentList(stdout, "prompts");
}

/**
 * Fetches a single item's content via `<kind> show <ref>`, returning its stdout
 * (markdown) for display in an editor.
 */
export async function showContent(ref: string, kind: ContentKind): Promise<string> {
  const { stdout } = await transport().exec([subcommand(kind), "show", ref]);
  return stdout;
}
