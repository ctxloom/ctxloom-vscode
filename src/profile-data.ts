// Data layer for the Profile Composer: the declared config (`profile show
// --format json`), the resolved assembly (`run -p <name> --dry-run --format
// json`), and mutations (`profile modify`/`create`). parseProfileDetail and
// parseDryRun are pure and vscode-free (unit-tested); the loaders/mutators go
// through the vscode-free transport() seam so this module stays testable.

import { transport } from "./transport";

/** A profile's declared (authored) configuration. */
export interface ProfileDetail {
  name: string;
  description: string;
  llm: string;
  parents: string[];
  /** Bundle refs and specific `bundle#fragments/name` refs this profile includes. */
  bundles: string[];
  tags: string[];
  excludeFragments: string[];
  excludeMcp: string[];
  path: string;
  isDefault: boolean;
}

interface RawDetail {
  name?: unknown;
  description?: unknown;
  llm?: unknown;
  parents?: unknown;
  bundles?: unknown;
  tags?: unknown;
  exclude_fragments?: unknown;
  exclude_mcp?: unknown;
  path?: unknown;
  default?: unknown;
}

/** Keeps only string entries of an unknown array; non-arrays yield []. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Parses `profile show --format json` into a ProfileDetail. */
export function parseProfileDetail(stdout: string): ProfileDetail {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object from `ctxloom profile show --format json`");
  }
  const raw: RawDetail = parsed;
  return {
    name: str(raw.name),
    description: str(raw.description),
    llm: str(raw.llm),
    parents: strings(raw.parents),
    bundles: strings(raw.bundles),
    tags: strings(raw.tags),
    excludeFragments: strings(raw.exclude_fragments),
    excludeMcp: strings(raw.exclude_mcp),
    path: str(raw.path),
    isDefault: raw.default === true,
  };
}

/** The resolved assembly a profile produces, from `run --dry-run --format json`. */
export interface ResolvedAssembly {
  llm: string;
  backend: string;
  profiles: string[];
  /** Fully inheritance-resolved fragment refs that would be assembled. */
  fragments: string[];
  /** The assembled context markdown. */
  context: string;
}

interface RawDryRun {
  llm?: unknown;
  backend?: unknown;
  profiles?: unknown;
  fragments?: unknown;
  context?: unknown;
}

/** Parses `run --dry-run --format json` into a ResolvedAssembly. */
export function parseDryRun(stdout: string): ResolvedAssembly {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object from `ctxloom run --dry-run --format json`");
  }
  const raw: RawDryRun = parsed;
  return {
    llm: str(raw.llm),
    backend: str(raw.backend),
    profiles: strings(raw.profiles),
    fragments: strings(raw.fragments),
    context: str(raw.context),
  };
}

/** Loads a profile's declared config. */
export async function getProfileDetail(name: string): Promise<ProfileDetail> {
  const { stdout } = await transport().exec(["profile", "show", name, "--format", "json"]);
  return parseProfileDetail(stdout);
}

/** Resolves a profile's effective assembly (parents + own − exclusions). */
export async function resolveProfile(name: string): Promise<ResolvedAssembly> {
  const { stdout } = await transport().exec(["run", "-p", name, "--dry-run", "--format", "json"]);
  return parseDryRun(stdout);
}

/** Runs `profile modify <name>` with the given flags. */
async function modify(name: string, flags: string[]): Promise<void> {
  await transport().exec(["profile", "modify", name, ...flags]);
}

/** Adds a bundle ref or a specific `bundle#fragments/name` ref to the profile. */
export function addBundle(name: string, ref: string): Promise<void> {
  return modify(name, ["--add-bundle", ref]);
}

/** Removes a bundle/ref from the profile's declared includes. */
export function removeBundle(name: string, ref: string): Promise<void> {
  return modify(name, ["--remove-bundle", ref]);
}

/** Adds a parent profile (inheritance). */
export function addParent(name: string, parent: string): Promise<void> {
  return modify(name, ["--add-parent", parent]);
}

/** Removes a parent profile. */
export function removeParent(name: string, parent: string): Promise<void> {
  return modify(name, ["--remove-parent", parent]);
}

/** Excludes an (often inherited) fragment by name. */
export function excludeFragment(name: string, fragment: string): Promise<void> {
  return modify(name, ["--exclude-fragment", fragment]);
}

/** Stops excluding a fragment. */
export function includeFragment(name: string, fragment: string): Promise<void> {
  return modify(name, ["--include-fragment", fragment]);
}

/** Sets (or clears, when empty) the profile's preferred LLM label. */
export function setLlm(name: string, llm: string): Promise<void> {
  return modify(name, ["--llm", llm]);
}

/** Sets the profile's description. */
export function setDescription(name: string, description: string): Promise<void> {
  return modify(name, ["-d", description]);
}

/** Creates a new, empty profile. */
export async function createProfile(name: string): Promise<void> {
  await transport().exec(["profile", "create", name]);
}
