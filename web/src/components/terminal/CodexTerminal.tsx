import { useCallback, useEffect, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { apiFetch, terminalSocketUrl, type TaskStatus, type TerminalStatus } from "../../api/client";

interface Props {
  sessionId: string | null;
  isVisible?: boolean;
  onStatus: (status: { terminalStatus: TerminalStatus; taskStatus: TaskStatus }) => void;
}

interface AuthState {
  authenticated: boolean;
}

type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "AUTH_REQUIRED"
  | "CLOSED"
  | "ERROR";

const terminalTheme = {
  background: "#101417",
  foreground: "#d8e0e4",
  cursor: "#f1f5f9",
  selectionBackground: "#2f4f5f"
};
const reconnectDelaysMs = [1000, 2000, 5000, 10000];

export default function CodexTerminal({ sessionId, isVisible = true, onStatus }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const canSendInputRef = useRef(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("DISCONNECTED");
  const [terminalWritable, setTerminalWritable] = useState(false);
  const [terminalNotice, setTerminalNotice] = useState<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const fitAndResize = useCallback(() => {
    const container = containerRef.current;
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !terminal || !fitAddon || container.offsetWidth === 0 || container.offsetHeight === 0) {
      return false;
    }

    fitAddon.fit();
    const socket = socketRef.current;
    const currentSessionId = sessionIdRef.current;
    if (socket?.readyState === WebSocket.OPEN && currentSessionId) {
      socket.send(
        JSON.stringify({
          type: "resize",
          sessionId: currentSessionId,
          cols: terminal.cols,
          rows: terminal.rows
        })
      );
    }
    return true;
  }, []);

  const scheduleFit = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (!fitAndResize()) {
        window.setTimeout(fitAndResize, 50);
      }
    });
  }, [fitAndResize]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Menlo, Monaco, 'SFMono-Regular', Consolas, monospace",
      fontSize: 13,
      theme: terminalTheme
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;

    scheduleFit();
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [scheduleFit]);

  useEffect(() => {
    if (isVisible) {
      scheduleFit();
    }
  }, [isVisible, scheduleFit]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    socketRef.current?.close();
    terminal.clear();
    setTerminalNotice(null);

    if (!sessionId) {
      setConnectionState("DISCONNECTED");
      canSendInputRef.current = false;
      setTerminalWritable(false);
      terminal.options.disableStdin = true;
      setTerminalNotice("Create or select a session to connect.");
      return;
    }

    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let lastTerminalStatus: TerminalStatus | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const setWritable = (enabled: boolean) => {
      canSendInputRef.current = enabled;
      setTerminalWritable(enabled);
      terminal.options.disableStdin = !enabled;
    };

    const scheduleReconnect = () => {
      if (disposed || lastTerminalStatus === "CLOSED" || lastTerminalStatus === "ERROR") {
        return;
      }
      const delayMs = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
      reconnectAttempt += 1;
      setConnectionState("RECONNECTING");
      terminal.writeln("");
      terminal.writeln(`[Agent Port] Connection lost. Reconnecting in ${Math.round(delayMs / 1000)}s...`);
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(connect, delayMs);
    };

    const checkAuthAndReconnect = async () => {
      try {
        const auth = await apiFetch<AuthState>("/api/auth/me");
        if (!auth.authenticated) {
          setWritable(false);
          setConnectionState("AUTH_REQUIRED");
          terminal.writeln("");
          terminal.writeln("[Agent Port] Sign in again to reconnect to this session.");
          window.dispatchEvent(new CustomEvent("agent-port-auth-expired"));
          return;
        }
      } catch {
        // The backend may be restarting or briefly unreachable. Keep retrying the socket.
      }
      scheduleReconnect();
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      clearReconnectTimer();
      setConnectionState(reconnectAttempt > 0 ? "RECONNECTING" : "CONNECTING");
      setWritable(false);
      const socket = new WebSocket(terminalSocketUrl(sessionId));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed) {
          return;
        }
        reconnectAttempt = 0;
        setConnectionState("CONNECTED");
        terminal.focus();
        scheduleFit();
      });

      socket.addEventListener("message", (event) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === "output" && typeof message.data === "string") {
          setTerminalNotice(null);
          if (message.replay === true) {
            terminal.reset();
          }
          terminal.write(message.data);
          if (message.replay === true) {
            terminal.scrollToBottom();
          }
          return;
        }
        if (message.type === "status") {
          const terminalStatus = message.terminalStatus as TerminalStatus;
          const taskStatus = message.taskStatus as TaskStatus;
          lastTerminalStatus = terminalStatus;
          onStatus({
            terminalStatus,
            taskStatus
          });
          setWritable(terminalStatus === "RUNNING");
          if (terminalStatus === "RUNNING") {
            setConnectionState("CONNECTED");
          }
          if (terminalStatus === "DISCONNECTED") {
            setConnectionState("DISCONNECTED");
          }
          if (terminalStatus === "CLOSED") {
            setConnectionState("CLOSED");
          }
          if (terminalStatus === "ERROR") {
            setConnectionState("ERROR");
          }
          return;
        }
        if (message.type === "error" && typeof message.message === "string") {
          if (message.code === "PTY_UNAVAILABLE") {
            terminal.clear();
            setTerminalNotice(message.message);
            return;
          }
          terminal.writeln("");
          terminal.writeln(`[Agent Port] ${message.message}`);
        }
      });

      socket.addEventListener("close", () => {
        if (disposed) {
          return;
        }
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setWritable(false);
        if (lastTerminalStatus === "CLOSED") {
          setConnectionState("CLOSED");
          return;
        }
        if (lastTerminalStatus === "ERROR") {
          setConnectionState("ERROR");
          return;
        }
        void checkAuthAndReconnect();
      });

      socket.addEventListener("error", () => {
        setWritable(false);
      });
    };

    setConnectionState("CONNECTING");
    canSendInputRef.current = false;
    setTerminalWritable(false);
    terminal.options.disableStdin = true;
    terminal.writeln("Connecting to Agent Port...");

    const inputSubscription = terminal.onData((data) => {
      const socket = socketRef.current;
      if (canSendInputRef.current && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", sessionId, data }));
      }
    });
    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      setWritable(false);
      inputSubscription.dispose();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [sessionId, onStatus]);

  function sendPlanCommand() {
    const socket = socketRef.current;
    if (!sessionId || !canSendInputRef.current || socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({ type: "input", sessionId, data: "/plan\r" }));
    terminalRef.current?.focus();
  }

  return (
    <div className="terminal-shell">
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          <span>Codex terminal</span>
          <button
            className="terminal-command-button"
            type="button"
            disabled={!terminalWritable}
            onClick={sendPlanCommand}
            title="Send native /plan to this Codex CLI session"
          >
            <ListChecks size={15} /> Plan
          </button>
        </div>
        <span className={`connection-dot ${connectionState.toLowerCase()}`}>{connectionState}</span>
      </div>
      <div className="terminal-container">
        {terminalNotice ? <div className="terminal-notice">{terminalNotice}</div> : null}
        <div ref={containerRef} className={terminalNotice ? "terminal-xterm hidden" : "terminal-xterm"} />
      </div>
    </div>
  );
}
