import { FormEvent, useState } from "react";
import { Send } from "lucide-react";
import type { CodexSession } from "../../api/client";

interface Props {
  activeSession: CodexSession | null;
  disabled: boolean;
  onSubmit: (prompt: string, title?: string) => Promise<void>;
}

export default function TaskComposer({ activeSession, disabled, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(prompt, title || undefined);
      setTitle("");
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  }

  const unavailable = disabled || submitting || !activeSession;

  return (
    <form className="task-composer" onSubmit={handleSubmit}>
      <div className="panel-heading">Task</div>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Task title"
        disabled={unavailable}
      />
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={activeSession ? "Send a remote-managed Codex task..." : "Create a session first."}
        disabled={unavailable}
        rows={5}
      />
      <button className="icon-text-button primary" type="submit" disabled={unavailable || !prompt.trim()}>
        <Send size={17} /> {submitting ? "Sending..." : "Send task"}
      </button>
    </form>
  );
}
