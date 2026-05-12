import type { TaskStatus } from "../../api/client";

export default function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const label = status.replaceAll("_", " ");
  return (
    <span className={`status-badge task-${status.toLowerCase()}`} title={label} aria-label={label}>
      {label}
    </span>
  );
}
