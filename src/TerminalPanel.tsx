import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import TerminalTools from "./TerminalTools";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, Plug, CircleHelp } from "lucide-react";
import { ErrorBox, IconButton, StatusDot } from "./components";
import type { PanelConfig } from "./types";
import { useSettings } from "./SettingsContext";
import { themeId, terminalTheme } from "./themes";
import { localShellLabel } from "./platform";
export default function TerminalPanel({
  config,
  onFile,
}: {
  config: PanelConfig;
  onFile: (path: string, line?: number) => void;
}) {
  const { effective: preferences } = useSettings();
  const colorTheme = themeId(preferences);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const localShell = useRef(preferences["terminal.localShell"]).current;
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const retries = useRef(0);
  const previousSession = useRef<string | null | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const [failure, setFailure] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () =>
      window.hrig.onResume(() => {
        retries.current = 0;
        setAttempt((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    if (
      !preferences["terminal.autoReconnect"] ||
      !config.seat ||
      (!error && ended === null) ||
      retries.current >= 6
    )
      return;
    const delay = Math.min(15000, 1000 * 2 ** retries.current++);
    setRetrying(true);
    const timer = setTimeout(() => {
      retryTimer.current = undefined;
      setRetrying(false);
      setAttempt((n) => n + 1);
    }, delay);
    retryTimer.current = timer;
    return () => {
      clearTimeout(timer);
      setRetrying(false);
    };
  }, [failure, config.seat?.id, preferences["terminal.autoReconnect"]]);
  useEffect(() => {
    if (!host.current) return;
    let disposed = false,
      connected = false;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    clearTimeout(retryTimer.current);
    setRetrying(false);
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
      // The official search addon uses buffer markers and decorations.
      allowProposedApi: true,
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
    terminalRef.current = term;
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        window.hrig.openTerminalLink(uri).catch((e) => setError(e.message));
      }),
    );
    term.registerLinkProvider({
      provideLinks(y, callback) {
        const text =
          term.buffer.active.getLine(y - 1)?.translateToString(true) || "";
        const links = [
          ...text.matchAll(
            /(?:^|[\s("'])((?:[A-Za-z]:[\\/]|\/|\.\.?[\\/])?[\w@.\-]+(?:[\\/][\w@.\-]+)*\.[A-Za-z0-9]{1,12})(?::(\d+)(?::\d+)?)?/g,
          ),
        ].map((match) => {
          const file = match[1],
            line = match[2] ? Number(match[2]) : undefined;
          const start = match.index! + match[0].indexOf(file);
          return {
            range: {
              start: { x: start + 1, y },
              end: { x: match.index! + match[0].length, y },
            },
            text: file,
            activate: () => {
              window.hrig
                .edit(config.connection, {
                  op: "read",
                  root: config.root,
                  path: file,
                })
                .then(() => {
                  if (!disposed) onFile(file, line);
                })
                .catch((e) => setError(e.message));
            },
          };
        });
        callback(links);
      },
    });
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
        setFailure((n) => n + 1);
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
        rigControlToken: config.rigControlToken,
        rigControlConfirmation: config.rigControlConfirmation,
        connection: config.connection,
        root: config.root,
        session: config.seat?.session,
        seatId: config.seat?.id,
        localShell,
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
        if (!disposed) {
          setError(e.message);
          setFailure((n) => n + 1);
        }
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
      if (terminalRef.current === term) {
        terminalRef.current = null;
        fitRef.current = null;
      }
    };
  }, [config.terminalId, config.seat?.session, attempt]);
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = preferences["terminal.fontFamily"];
    term.options.fontSize = preferences["terminal.fontSize"];
    term.options.lineHeight = preferences["terminal.lineHeight"];
    term.options.cursorStyle = preferences["terminal.cursorStyle"] as
      "bar" | "block" | "underline";
    term.options.cursorBlink =
      preferences["terminal.cursorBlink"] &&
      !preferences["appearance.reduceMotion"];
    term.options.scrollback = preferences["terminal.scrollback"];
    term.options.theme = terminalTheme(preferences, colorTheme);
    try {
      fitRef.current?.fit();
      window.hrig.resizeTerminal(config.terminalId!, term.cols, term.rows);
    } catch {}
  }, [preferences, colorTheme, attempt, config.seat?.session]);
  return (
    <div className="terminal-panel">
      <div className="session-toolbar">
        <span className="session-avatar">
          {config.seat ? config.seat.name.slice(0, 2).toUpperCase() : ">_"}
        </span>
        <div>
          <strong>
            {config.rigControlToken
              ? config.role || "OpenRig action"
              : config.seat?.name || "Shell"}
          </strong>
          <span>
            {config.rigControlToken
              ? "Reviewed one-time command"
              : config.seat
                ? `${config.seat.runtime}${config.seat.model ? " · " + config.seat.model : ""}`
                : config.connection.kind === "local"
                  ? localShellLabel(localShell)
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
        {!config.rigControlToken && (
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
        )}
      </div>
      {config.seat && (
        <div className="terminal-context">
          <CircleHelp size={12} />
          Connected to an existing seat. Closing this panel only detaches.
        </div>
      )}
      {config.rigControlToken && (
        <div className="terminal-context">
          This action runs once. Close this terminal and review the action again
          to run it another time.
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
      <TerminalTools
        terminal={terminalRef}
        generation={attempt * 2 + (ready ? 1 : 0)}
      />
      <div className="terminal-host" ref={host} />
      {ended !== null && (
        <div className="terminal-ended">
          {config.rigControlToken ? (
            `Command finished (exit ${ended}). Review the action again to run it another time.`
          ) : (
            <>
              Connection ended (exit {ended}).{" "}
              <button onClick={() => setAttempt((n) => n + 1)}>
                Reconnect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
