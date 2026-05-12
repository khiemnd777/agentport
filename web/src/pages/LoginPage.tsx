import { FormEvent, useState } from "react";
import { Lock } from "lucide-react";
import { apiFetch } from "../api/client";

interface Props {
  auth: {
    requirePassword: boolean;
    passwordConfigured: boolean;
  };
  error: string | null;
  onLogin: () => Promise<void>;
}

export default function LoginPage({ auth, error, onLogin }: Props) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(error);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      await onLogin();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-icon">
          <Lock size={22} />
        </div>
        <h1>Agent Port</h1>
        <p>Private local access for your MacBook Codex sessions.</p>
        {!auth.passwordConfigured && auth.requirePassword ? (
          <div className="error-banner">APP_PASSWORD is not configured on the server.</div>
        ) : null}
        <label>
          App password
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter APP_PASSWORD"
          />
        </label>
        {formError ? <div className="error-banner">{formError}</div> : null}
        <button type="submit" disabled={submitting || (auth.requirePassword && !password)}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
