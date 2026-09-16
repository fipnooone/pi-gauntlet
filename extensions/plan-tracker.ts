/**
 * Plan Tracker Extension
 *
 * A native pi tool for tracking plan progress.
 * State is stored in tool result details for proper branching support.
 * Shows a persistent TUI widget above the editor.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "@sinclair/typebox";

const TASK_STATUSES = ["pending", "in_progress", "complete", "failed", "skipped"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

interface Task { name: string; status: TaskStatus; }
interface PlanTrackerDetails { action: "init" | "add" | "update" | "status" | "clear"; tasks: Task[]; error?: string; }

const PlanTrackerParams = Type.Object({
  action: StringEnum(["init", "add", "update", "status", "clear"] as const, { description: "Action to perform" }),
  tasks: Type.Optional(Type.Array(Type.Union([
    Type.String(),
    Type.Object({ name: Type.String(), status: StringEnum(TASK_STATUSES, { description: "Status to recreate the task with (init only)" }) }),
  ]), { description: "Tasks for init and add. A string is a pending task. init also accepts { name, status } to recreate a list with known statuses (fresh session, amendment re-init); the whole list must satisfy the pending-suffix rule." })),
  index: Type.Optional(Type.Integer({ minimum: 0, description: "Task index, 0-based (for update)" })),
  status: Type.Optional(StringEnum(TASK_STATUSES, { description: "New status (for update). failed is terminal-negative (ran and did not pass); skipped is terminal, not applicable in this run, counted as done. pending is set only by init/add; to redo a task, reopen it as in_progress, or re-init with {name, status}[] to recreate a whole list." })),
});

export type PlanTrackerInput = Static<typeof PlanTrackerParams>;

/** Indices of every pending task that has a non-pending task after it (empty = valid snapshot). */
export function validateSnapshot(tasks: Task[]): number[] {
  const offenders: number[] = [];
  let seenNonPending = false;
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].status !== "pending") seenNonPending = true;
    else if (seenNonPending) offenders.unshift(i);
  }
  return offenders;
}

const RULE_LINE = "Rule: pending tasks must trail every started or finished task.";
const snapshotLine = (tasks: Task[]): string => tasks.map((t, i) => `${i} ${t.name}=${t.status}`).join(", ");
const offenderList = (tasks: Task[], indices: number[]): string => indices.map((i) => `${i} "${tasks[i].name}"`).join(", ");
const normalizeTask = (t: string | { name: string; status: TaskStatus }): Task => typeof t === "string" ? { name: t, status: "pending" } : { name: t.name, status: t.status };

const glyph = (status: TaskStatus, theme?: Theme): string => {
  const [color, icon]: [string, string] = status === "complete" ? ["success", "✓"] : status === "in_progress" ? ["warning", "→"] : status === "failed" ? ["error", "✗"] : status === "skipped" ? ["dim", "⊘"] : ["dim", "○"];
  return theme ? theme.fg(color as Parameters<Theme["fg"]>[0], icon) : icon;
};

const counts = (tasks: Task[]) => {
  const by = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;
  const failed = by("failed");
  const skipped = by("skipped");
  return { done: by("complete") + skipped, inProgress: by("in_progress"), pending: by("pending"), failed, skipped, suffix: `${failed > 0 ? `, ${failed} failed` : ""}${skipped > 0 ? `, ${skipped} skipped` : ""}` };
};

function formatWidget(tasks: Task[], theme: Theme): string {
  if (tasks.length === 0) return "";
  const { done } = counts(tasks);
  const icons = tasks.map((t) => glyph(t.status, theme)).join("");
  const current = tasks.find((t) => t.status === "in_progress") ?? tasks.find((t) => t.status === "pending");
  const currentName = current ? `  ${current.name}` : "";
  return `${theme.fg("muted", "Tasks:")} ${icons} ${theme.fg("muted", `(${done}/${tasks.length})`)}${currentName}`;
}

function formatStatus(tasks: Task[]): string {
  if (tasks.length === 0) return "No plan active.";
  const c = counts(tasks);
  const groups = [[c.inProgress, "in progress"], [c.pending, "pending"], [c.failed, "failed"], [c.skipped, "skipped"]] as const;
  const detail = groups.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  const lines: string[] = [`Plan: ${c.done}/${tasks.length} done${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`, ""];
  for (let i = 0; i < tasks.length; i++) lines.push(`  ${glyph(tasks[i].status)} [${i}] ${tasks[i].name}`);
  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  let tasks: Task[] = [];

  const reconstructState = (ctx: ExtensionContext) => {
    tasks = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "plan_tracker") continue;
      const details = msg.details as PlanTrackerDetails | undefined;
      if (details && !details.error) {
        tasks = details.tasks.map((t) => ({ ...t }));
      }
    }
  };

  const updateWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    if (tasks.length === 0) {
      ctx.ui.setWidget("plan_tracker", undefined);
    } else {
      ctx.ui.setWidget("plan_tracker", (_tui, theme) => {
        return new Text(formatWidget(tasks, theme), 0, 0);
      });
    }
  };

  // Reconstruct state + widget on session events
  for (const event of ["session_start", "session_switch", "session_fork", "session_tree"] as const) {
    pi.on(event, async (_event, ctx) => {
      reconstructState(ctx);
      updateWidget(ctx);
    });
  }

  pi.registerTool({
    name: "plan_tracker",
    label: "Plan Tracker",
    description:
      "Track progress while EXECUTING an implementation plan (the implement phase), a verify-phase conformance fix wave, or another bounded gate checklist (e.g. pre-merge PR verification). Statuses: pending (not yet touched), in_progress (started; several at once is fine), complete, failed (terminal-negative: ran and did not pass; never counted done), skipped (terminal: not applicable in this run; counted done). Rule: pending tasks must trail every started or finished task - an update that would leave a pending task ahead of a non-pending one is rejected with the fix. update never sets pending; init and add do. Actions: init (set task list; elements are task-name strings or { name, status } to recreate a list with known statuses), add (append tasks as pending; existing statuses preserved), update (change task status), status (show current state), clear (remove plan). Do NOT use for brainstorming, research, or planning checklists: those phases are open-ended and a bounded task list misrepresents them as a fixed N-step process.",
    parameters: PlanTrackerParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      switch (params.action) {
        case "init": {
          if (!params.tasks || params.tasks.length === 0) {
            return {
              content: [{ type: "text", text: "Error: tasks array required for init" }],
              details: {
                action: "init",
                tasks: tasks.map((t) => ({ ...t })),
                error: "tasks required",
              } as PlanTrackerDetails,
            };
          }
          const proposed = params.tasks.map(normalizeTask);
          const offenders = validateSnapshot(proposed);
          if (offenders.length > 0) {
            return {
              content: [{ type: "text", text: [
                `Error: cannot init: pending tasks precede started or finished ones: ${offenderList(proposed, offenders)}.`,
                RULE_LINE,
                "Reorder the list or restate those statuses truthfully, then retry.",
                `Proposed: ${snapshotLine(proposed)}`,
              ].join("\n") }],
              details: { action: "init", tasks: tasks.map((t) => ({ ...t })), error: `pending-suffix violation: ${offenders.join(",")}` } as PlanTrackerDetails,
            };
          }
          tasks = proposed;
          updateWidget(ctx);
          return {
            content: [
              {
                type: "text",
                text: `Plan initialized with ${tasks.length} tasks.\n${formatStatus(tasks)}`,
              },
            ],
            details: { action: "init", tasks: tasks.map((t) => ({ ...t })) } as PlanTrackerDetails,
          };
        }

        case "add": {
          if (!params.tasks || params.tasks.length === 0) {
            return {
              content: [{ type: "text", text: "Error: tasks array required for add" }],
              details: {
                action: "add",
                tasks: tasks.map((t) => ({ ...t })),
                error: "tasks required",
              } as PlanTrackerDetails,
            };
          }
          tasks.push(...params.tasks.map((t) => ({ name: normalizeTask(t).name, status: "pending" as TaskStatus })));
          updateWidget(ctx);
          return {
            content: [
              {
                type: "text",
                text: `Added ${params.tasks.length} tasks (${tasks.length} total).\n${formatStatus(tasks)}`,
              },
            ],
            details: { action: "add", tasks: tasks.map((t) => ({ ...t })) } as PlanTrackerDetails,
          };
        }

        case "update": {
          if (params.index === undefined || !params.status) {
            return {
              content: [{ type: "text", text: "Error: index and status required for update" }],
              details: {
                action: "update",
                tasks: tasks.map((t) => ({ ...t })),
                error: "index and status required",
              } as PlanTrackerDetails,
            };
          }
          if (tasks.length === 0) {
            return {
              content: [{ type: "text", text: "Error: no plan active. Use init first." }],
              details: {
                action: "update",
                tasks: [],
                error: "no plan active",
              } as PlanTrackerDetails,
            };
          }
          if (params.index < 0 || params.index >= tasks.length) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: index ${params.index} out of range (0-${tasks.length - 1})`,
                },
              ],
              details: {
                action: "update",
                tasks: tasks.map((t) => ({ ...t })),
                error: `index ${params.index} out of range`,
              } as PlanTrackerDetails,
            };
          }
          const target = tasks[params.index];
          if (params.status === "pending") {
            return {
              content: [{ type: "text", text: [
                `Error: cannot set task ${params.index} "${target.name}" to pending: update never sets pending; a task is pending only from init/add.`,
                "To redo it, update it to in_progress. To recreate the whole list, re-init with {name, status}[].",
                `Current: ${snapshotLine(tasks)}`,
              ].join("\n") }],
              details: { action: "update", tasks: tasks.map((t) => ({ ...t })), error: "update cannot set pending" } as PlanTrackerDetails,
            };
          }
          const candidate = tasks.map((t, i) => (i === params.index ? { ...t, status: params.status as TaskStatus } : { ...t }));
          const offenders = validateSnapshot(candidate);
          if (offenders.length > 0) {
            return {
              content: [{ type: "text", text: [
                `Error: cannot set task ${params.index} "${target.name}" to ${params.status}: pending tasks precede it: ${offenderList(tasks, offenders)}.`,
                RULE_LINE,
                "Fix first, then retry: update each listed task to in_progress (working on it now), complete, failed, or skipped (not applicable in this run); or, if the list order itself is wrong, re-init with {name, status}[] keeping every task and its true status so the untouched ones trail.",
                "Never clear, drop tasks, or record a status the work has not actually reached.",
                `Current: ${snapshotLine(tasks)}`,
              ].join("\n") }],
              details: { action: "update", tasks: tasks.map((t) => ({ ...t })), error: `pending-suffix violation: ${offenders.join(",")}` } as PlanTrackerDetails,
            };
          }
          tasks = candidate;
          updateWidget(ctx);
          return {
            content: [
              {
                type: "text",
                text: `Task ${params.index} "${tasks[params.index].name}" → ${params.status}\n${formatStatus(tasks)}`,
              },
            ],
            details: { action: "update", tasks: tasks.map((t) => ({ ...t })) } as PlanTrackerDetails,
          };
        }

        case "status": {
          return {
            content: [{ type: "text", text: formatStatus(tasks) }],
            details: { action: "status", tasks: tasks.map((t) => ({ ...t })) } as PlanTrackerDetails,
          };
        }

        case "clear": {
          const count = tasks.length;
          tasks = [];
          updateWidget(ctx);
          return {
            content: [
              {
                type: "text",
                text: count > 0 ? `Plan cleared (${count} tasks removed).` : "No plan was active.",
              },
            ],
            details: { action: "clear", tasks: [] } as PlanTrackerDetails,
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown action: ${params.action}` }],
            details: {
              action: "status",
              tasks: tasks.map((t) => ({ ...t })),
              error: `unknown action`,
            } as PlanTrackerDetails,
          };
      }
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("plan_tracker "));
      text += theme.fg("muted", args.action);
      if (args.action === "update" && args.index !== undefined) {
        text += ` ${theme.fg("accent", `[${args.index}]`)}`;
        if (args.status) text += ` → ${theme.fg("dim", args.status)}`;
      }
      if ((args.action === "init" || args.action === "add") && args.tasks) {
        text += ` ${theme.fg("dim", `(${args.tasks.length} tasks)`)}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as PlanTrackerDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const taskList = details.tasks;
      switch (details.action) {
        case "init":
          return new Text(
            theme.fg("success", "✓ ") + theme.fg("muted", `Plan initialized with ${taskList.length} tasks`),
            0,
            0,
          );
        case "add":
          return new Text(
            theme.fg("success", "✓ ") + theme.fg("muted", `Added tasks (${taskList.length} total)`),
            0,
            0,
          );
        case "update": {
          const c = counts(taskList);
          return new Text(
            theme.fg("success", "✓ ") + theme.fg("muted", `Updated (${c.done}/${taskList.length} done${c.suffix})`),
            0,
            0,
          );
        }
        case "status": {
          if (taskList.length === 0) {
            return new Text(theme.fg("dim", "No plan active"), 0, 0);
          }
          const c = counts(taskList);
          let text = theme.fg("muted", `${c.done}/${taskList.length} done${c.suffix}`);
          for (const t of taskList) {
            const icon = glyph(t.status, theme);
            text += `\n${icon} ${theme.fg("muted", t.name)}`;
          }
          return new Text(text, 0, 0);
        }
        case "clear":
          return new Text(theme.fg("success", "✓ ") + theme.fg("muted", "Plan cleared"), 0, 0);
        default:
          return new Text(theme.fg("dim", "Done"), 0, 0);
      }
    },
  });
}
