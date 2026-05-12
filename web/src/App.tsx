import { useEffect, useState } from "react";
import { apiFetch } from "./api/client";
import LoginPage from "./pages/LoginPage";
import DesktopPage from "./pages/DesktopPage";
import { useDisplayMode } from "./theme";

interface AuthState {
  authenticated: boolean;
  requirePassword: boolean;
  passwordConfigured: boolean;
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { displayMode, setDisplayMode } = useDisplayMode();

  async function loadMe() {
    try {
      const next = await apiFetch<AuthState>("/api/auth/me");
      setAuth(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setAuth({ authenticated: false, requirePassword: true, passwordConfigured: false });
    }
  }

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    function handleAuthExpired() {
      setAuth((current) => ({
        authenticated: false,
        requirePassword: current?.requirePassword ?? true,
        passwordConfigured: current?.passwordConfigured ?? true
      }));
    }

    window.addEventListener("agent-port-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("agent-port-auth-expired", handleAuthExpired);
  }, []);

  if (!auth) {
    return <div className="boot-screen">Agent Port</div>;
  }

  if (!auth.authenticated) {
    return <LoginPage auth={auth} error={error} onLogin={loadMe} />;
  }

  return (
    <DesktopPage
      displayMode={displayMode}
      onDisplayModeChange={setDisplayMode}
      onLogout={loadMe}
    />
  );
}
