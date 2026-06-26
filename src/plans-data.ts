// Data layer for the Plans view. Plans are owned by the taskloom companion:
// `taskloom plan list --json` enumerates the session plan documents
// (~/.ctxloom/sessions/<harp>/*.plan.md) with their parsed frontmatter, and
// `taskloom plan show <path>` returns one plan's content. parsePlans is pure and
// vscode-free (unit-tested); the loaders go through the shared taskloom-cli seam.

import { taskloomExec } from "./taskloom-cli";

/** A session plan document, as returned by `taskloom plan list --json`. */
export interface Plan {
  /** Absolute path to the .plan.md file. */
  path: string;
  /** Base name without the .plan.md extension. */
  name: string;
  /** Frontmatter title, falling back to the name. */
  title: string;
  /** Owning session harp (the containing directory name). */
  session: string;
  /** Frontmatter `sessions:` list (every session that touched the plan). */
  sessions: string[];
}

interface RawPlan {
  path?: unknown;
  name?: unknown;
  title?: unknown;
  session?: unknown;
  sessions?: unknown;
}

/**
 * Parses the JSON array emitted by `taskloom plan list --json` into Plans.
 * Entries without a string `path` are skipped. `sessions` is filtered to
 * strings (the backend emits null when a plan has no frontmatter list). Throws
 * on output that isn't a JSON array so the caller can surface a clear error.
 */
export function parsePlans(stdout: string): Plan[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("expected a JSON array from `taskloom plan list --json`");
  }
  const plans: Plan[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const raw: RawPlan = item;
    if (typeof raw.path !== "string") {
      continue;
    }
    const name = typeof raw.name === "string" ? raw.name : "";
    plans.push({
      path: raw.path,
      name,
      title: typeof raw.title === "string" && raw.title !== "" ? raw.title : name,
      session: typeof raw.session === "string" ? raw.session : "",
      sessions: stringList(raw.sessions),
    });
  }
  return plans;
}

/** Keeps only string entries of an unknown array; non-arrays yield []. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string");
}

/** Lists all session plans via `taskloom plan list --json`. */
export async function listPlans(): Promise<Plan[]> {
  return parsePlans(await taskloomExec(["plan", "list", "--json"]));
}

/** Returns a plan's markdown content via `taskloom plan show <path>`. */
export async function showPlan(path: string): Promise<string> {
  return taskloomExec(["plan", "show", path]);
}
