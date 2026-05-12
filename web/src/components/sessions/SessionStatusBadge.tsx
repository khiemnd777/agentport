import type { TerminalStatus } from "../../api/client";

export default function SessionStatusBadge({ status }: { status: TerminalStatus }) {
  return (
    <span className={`status-badge terminal-${status.toLowerCase()}`} title={status} aria-label={status}>
      {status}
    </span>
  );
}
