// Data layer for the Tasks view, backed by the `taskloom` companion CLI (via the
// shared taskloom-cli.ts seam). Pure parsing here is vscode-free and unit-tested
// (tasks-data.test.ts).
//
// taskloom emits a stable JSON array via `list --json` ({harp_id, text, status,
// ...}), so parseTasks parses that rather than the human table.

import { taskloomExec } from "./taskloom-cli";

/** A single taskloom task, keyed by its harp id (e.g. "swift-amber-falcon"). */
export interface Task {
  harpId: string;
  status: string;
  text: string;
  /** The revive condition for a Deferred task, when present. */
  trigger?: string;
}

interface RawTask {
  harp_id?: unknown;
  status?: unknown;
  text?: unknown;
  trigger?: unknown;
}

/**
 * Parses the JSON array emitted by `taskloom list --json` into Tasks (mapping
 * harp_id→harpId). Entries without a string harp_id are skipped. Throws on
 * output that isn't a JSON array so the caller can surface a clear error.
 */
export function parseTasks(stdout: string): Task[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("expected a JSON array from `taskloom list --json`");
  }
  const tasks: Task[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const raw: RawTask = item;
    if (typeof raw.harp_id !== "string") {
      continue;
    }
    const task: Task = {
      harpId: raw.harp_id,
      status: typeof raw.status === "string" ? raw.status : "",
      text: typeof raw.text === "string" ? raw.text : "",
    };
    if (typeof raw.trigger === "string" && raw.trigger !== "") {
      task.trigger = raw.trigger;
    }
    tasks.push(task);
  }
  return tasks;
}

/**
 * Lists all tasks (including Done/Archived via --all so the view can group every
 * status), parsed from `taskloom list --json`.
 */
export async function listTasks(): Promise<Task[]> {
  return parseTasks(await taskloomExec(["list", "--all", "--json"]));
}

/** Adds a new task with the given text (defaults to To Do). */
export async function addTask(text: string): Promise<void> {
  await taskloomExec(["add", text]);
}

/** Changes a task's status. */
export async function setTaskStatus(harpId: string, status: string): Promise<void> {
  await taskloomExec(["status", harpId, status]);
}

/** Replaces a task's text in place (full new text). */
export async function editTask(harpId: string, text: string): Promise<void> {
  await taskloomExec(["edit", harpId, text]);
}
