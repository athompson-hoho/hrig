import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, Plug, CircleHelp } from "lucide-react";
import { ErrorBox, IconButton, StatusDot } from "./components";
import type { PanelConfig } from "./types";
export default function TerminalPanel({ config }: { config: PanelConfig }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const retries = useRef(0);
  const previousSession = useRef<string | null | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  useEffect(
    () =>
      window.hrig.onResume(() => {
        retries.current = 0;
        setAttempt((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    if (!config.seat || (!error && ended === null) || retries.current >= 6)
      return;
    const delay = Math.min(15000, 1000 * 2 ** retries.current++);
    setRetrying(true);
    const timer = setTimeout(() => {
      setRetrying(false);
      setAttempt((n) => n + 1);
    }, delay);
    return () => {
      clearTimeout(timer);
      setRetrying(false);
    };
  }, [error, ended, config.seat?.id]);
  useEffect(() => {
    if (!host.current) return;
    let disposed = false,
      connected = false;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    setError("");
    setEnded(null);
    setReady(false);
    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.28,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10000,
      allowProposedApi: false,
      theme: {
        background: "#14161b",
        foreground: "#cdd2dc",
        cursor: "#98e2c2",
        selectionBackground: "#33564e",
        black: "#20232c",
        red: "#ed929d",
        green: "#98d8b3",
        yellow: "#dfc28e",
        blue: "#91b4ec",
        magenta: "#c1a0e0",
        cyan: "#8cd3d9",
        white: "#d7dce7",
        brightBlack: "#747c8e",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    const id = config.terminalId!;
    const resize = () => {
      if (disposed) return;
      try {
        if (
          host.current &&
          host.current.clientWidth > 0 &&
          host.current.clientHeight > 0
        ) {
          fit.fit();
          if (connected) window.hrig.resizeTerminal(id, term.cols, term.rows);
        }
      } catch {}
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    const pending: string[] = [];
    const unsubscribe = window.hrig.onTerminal((event) => {
      if (event.id !== id || disposed) return;
      if (event.data) {
        if (connected) term.write(event.data);
        else pending.push(event.data);
      }
      if (event.exitCode !== undefined) {
        setEnded(event.exitCode);
        connected = false;
      }
    });
    const input = term.onData((data) => {
      if (connected) window.hrig.writeTerminal(id, data);
    });
    const start = async () => {
      if (
        previousSession.current !== undefined &&
        previousSession.current !== config.seat?.session
      )
        await window.hrig.closeTerminal(id);
      if (disposed) return;
      previousSession.current = config.seat?.session;
      return window.hrig.createTerminal({
        id,
        connection: config.connection,
        root: config.root,
        session: config.seat?.session,
        seatId: config.seat?.id,
        cols: term.cols,
        rows: term.rows,
      });
    };
    start()
      .then((result) => {
        if (disposed || !result) return;
        connected = true;
        stableTimer = setTimeout(() => {
          if (!disposed && connected) retries.current = 0;
        }, 30000);
        setEnded(null);
        setReady(true);
        if (result.buffer) term.write(result.buffer);
        else pending.forEach((data) => term.write(data));
        resize();
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    const focus = () => term.focus();
    host.current.addEventListener("mousedown", focus);
    return () => {
      disposed = true;
      clearTimeout(stableTimer);
      observer.disconnect();
      unsubscribe();
      input.dispose();
      term.dispose();
    };
  }, [config.terminalId, config.seat?.session, attempt]);
  return (
    <div className="terminal-panel">
      <div className="session-toolbar">
        <span className="session-avatar">
          {config.seat ? config.seat.name.slice(0, 2).toUpperCase() : ">_"}
        </span>
        <div>
          <strong>{config.seat?.name || "Shell"}</strong>
          <span>
            {config.seat
              ? `${config.seat.runtime}${config.seat.model ? " · " + config.seat.model : ""}`
              : config.connection.kind === "local"
                ? "Windows PowerShell"
                : "Bash"}
          </span>
        </div>
        <span className="session-connection">
          <Plug size={11} />
          {config.connection.name}
        </span>
        <StatusDot
          status={ended !== null ? "stopped" : ready ? "idle" : "unknown"}
        />
        <IconButton
          title="Reconnect terminal"
          onClick={async () => {
            await window.hrig.closeTerminal(config.terminalId!);
            retries.current = 0;
            setAttempt((n) => n + 1);
          }}
        >
          <RotateCcw size={13} />
        </IconButton>
      </div>
      {config.seat && (
        <div className="terminal-context">
          <CircleHelp size={12} />
          Connected to an existing seat. Closing this panel only detaches.
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {config.seat && retries.current >= 6 && (error || ended !== null) && (
        <div className="editor-notice">
          Automatic retries paused. Use Reconnect when the host is ready.
        </div>
      )}
      {retrying && (
        <div className="editor-notice">
          Reconnecting to the existing seat… retry {retries.current} of 6
        </div>
      )}
      <div className="terminal-host" ref={host} />
      {ended !== null && (
        <div className="terminal-ended">
          Connection ended (exit {ended}).{" "}
          <button onClick={() => setAttempt((n) => n + 1)}>Reconnect</button>
        </div>
      )}
    </div>
  );
}
