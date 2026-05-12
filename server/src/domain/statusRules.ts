import type { ControlMode } from "./sessionTypes";
import type { TaskStatus } from "./taskTypes";

const terminalTaskStatuses = new Set<TaskStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

export function canEnterWaitingForUser(subject: { control_mode: ControlMode }): boolean {
  return subject.control_mode === "web_managed";
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return terminalTaskStatuses.has(status);
}

export function validateStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
  controlMode: ControlMode
): void {
  if (from === to) {
    return;
  }

  if (terminalTaskStatuses.has(from)) {
    throw new Error(`Task status ${from} cannot transition to ${to}`);
  }

  const waitingAllowed = controlMode === "web_managed";

  const allowed =
    (from === "IDLE" && to === "CREATED") ||
    (from === "CREATED" && to === "RUNNING") ||
    (from === "CREATED" && to === "CANCELLED") ||
    (from === "RUNNING" && to === "WAITING_FOR_USER" && waitingAllowed) ||
    (from === "WAITING_FOR_USER" && to === "RUNNING" && waitingAllowed) ||
    (from === "RUNNING" && terminalTaskStatuses.has(to)) ||
    (from === "WAITING_FOR_USER" && to === "CANCELLED");

  if (!allowed) {
    throw new Error(`Invalid task status transition ${from} -> ${to}`);
  }
}
