import { FormEvent, useState } from "react";
import { Send } from "lucide-react";
import type { Task } from "../../api/client";

interface Props {
  task: Task | null;
  onSubmit: (text: string) => Promise<void>;
}

export default function FollowUpInput({ task, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const visible = task?.status === "WAITING_FOR_USER";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(text);
      setText("");
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <form className="follow-up-input" onSubmit={handleSubmit}>
      <div className="panel-heading">Waiting for user</div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Answer Codex and resume the task..."
        rows={4}
      />
      <button className="icon-text-button attention" type="submit" disabled={submitting || !text.trim()}>
        <Send size={17} /> {submitting ? "Sending..." : "Send answer"}
      </button>
    </form>
  );
}
