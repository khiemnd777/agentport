import type { RemoteCodexEvent, Task } from "../../api/client";
import TaskStatusBadge from "./TaskStatusBadge";

interface Props {
  task: Task | null;
  events: RemoteCodexEvent[];
}

export default function TaskEventTimeline({ task, events }: Props) {
  return (
    <section className="task-timeline">
      <div className="panel-heading">Lifecycle</div>
      {task ? (
        <div className="task-summary">
          <strong>{task.title}</strong>
          <TaskStatusBadge status={task.status} />
          {task.last_error ? <p className="error-text">{task.last_error}</p> : null}
        </div>
      ) : (
        <div className="empty-state">No task selected.</div>
      )}
      <div className="timeline-list">
        {events.map((event) => (
          <div className="timeline-item" key={event.id}>
            <span>{event.event_type.replaceAll("_", " ")}</span>
            <strong>{event.summary}</strong>
            <time>{new Date(event.event_time).toLocaleTimeString()}</time>
          </div>
        ))}
      </div>
    </section>
  );
}
