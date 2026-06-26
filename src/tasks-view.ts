import * as vscode from "vscode";
import {
  addTask,
  editTask,
  listTasks,
  setTaskStatus,
  type Task,
} from "./tasks-data";
import { requireItem } from "./view-util";

// The statuses the view offers as setStatus targets and renders as group
// headers, in display order. "Archived" is a valid taskloom status but is
// omitted from the picker/headers as a terminal state the GUI does not promote;
// archived tasks simply don't appear under any shown group.
const STATUS_ORDER = ["In Progress", "To Do", "Deferred", "Done"] as const;

/**
 * A task leaf in the Tasks tree. Subclasses TreeItem to carry the task's harp id
 * (the key passed to `taskloom status`/`edit`) alongside the displayed text, so
 * the item-context commands act on the exact task. label = text, description =
 * harpId, contextValue gates the per-item menus.
 */
class TaskItem extends vscode.TreeItem {
  constructor(readonly task: Task) {
    super(task.text, vscode.TreeItemCollapsibleState.None);
    this.description = task.harpId;
    this.tooltip = `${task.harpId} — ${task.status}`;
    this.contextValue = "ctxloomTask";
  }
}

/**
 * A status group header in the Tasks tree, e.g. "In Progress (2)". Carries the
 * tasks it groups so getChildren can return them without re-fetching.
 */
class StatusGroup extends vscode.TreeItem {
  constructor(readonly status: string, readonly tasks: Task[]) {
    super(`${status} (${tasks.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "ctxloomTaskGroup";
  }
}

type TaskTreeNode = StatusGroup | TaskItem;

/**
 * The Tasks tree in the ctxloom Activity Bar container. Top-level rows are
 * status groups (In Progress, To Do, Deferred, Done) with a count; their
 * children are the tasks in that status. A thin frontend: all task logic lives
 * in taskloom (via tasks-data.ts) and parsing in parseTasks.
 */
export class TasksProvider implements vscode.TreeDataProvider<TaskTreeNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-reads the task list, repopulating the tree. */
  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: TaskTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskTreeNode): Promise<TaskTreeNode[]> {
    if (element instanceof StatusGroup) {
      return element.tasks.map((task) => new TaskItem(task));
    }
    if (element instanceof TaskItem) {
      return [];
    }
    const tasks = await listTasks();
    // One group per status in display order, skipping statuses with no tasks.
    return STATUS_ORDER.flatMap((status) => {
      const inStatus = tasks.filter((task) => task.status === status);
      return inStatus.length > 0 ? [new StatusGroup(status, inStatus)] : [];
    });
  }
}

/**
 * Registers the Tasks tree view and its commands: refresh, add (prompt then
 * `taskloom add`), set-status (pick a status then `taskloom status`), and edit
 * (prompt prefilled with current text then `taskloom edit`). Each mutating
 * command refreshes the tree on success.
 */
export function registerTasksView(context: vscode.ExtensionContext): void {
  const provider = new TasksProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ctxloom.tasks", provider),
    vscode.commands.registerCommand("ctxloom.tasks.refresh", () =>
      provider.refresh(),
    ),
    vscode.commands.registerCommand("ctxloom.tasks.add", async () => {
      const text = await vscode.window.showInputBox({
        prompt: "New task",
        placeHolder: "What needs doing?",
      });
      const trimmed = text?.trim();
      if (!trimmed) {
        return;
      }
      await addTask(trimmed);
      provider.refresh();
    }),
    vscode.commands.registerCommand(
      "ctxloom.tasks.setStatus",
      async (item: TaskItem) => {
        if (!requireItem(item)) {
          return;
        }
        const status = await vscode.window.showQuickPick([...STATUS_ORDER], {
          placeHolder: `Status for ${item.task.harpId}`,
        });
        if (!status) {
          return;
        }
        await setTaskStatus(item.task.harpId, status);
        provider.refresh();
      },
    ),
    vscode.commands.registerCommand(
      "ctxloom.tasks.edit",
      async (item: TaskItem) => {
        if (!requireItem(item)) {
          return;
        }
        const text = await vscode.window.showInputBox({
          prompt: `Edit ${item.task.harpId}`,
          value: item.task.text,
        });
        const trimmed = text?.trim();
        if (!trimmed || trimmed === item.task.text) {
          return;
        }
        await editTask(item.task.harpId, trimmed);
        provider.refresh();
      },
    ),
  );
}
