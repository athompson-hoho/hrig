import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import TerminalTools from "./TerminalTools";
import TerminalSessionTools from "./TerminalSessionTools";
import { terminalPathLinks } from "./terminal-path-links";
import { terminalSeatActivity } from "./terminal-seat-activity";
import { snippetError } from "./terminal-commands";
import TerminalReconnect from "./TerminalReconnect";
import {
  reconnectReason,
  restoreLine,
  retryDelay,
  scrollOffset,
} from "./terminal-reconnect";
import TerminalScrollback from "./TerminalScrollback";
import TerminalAlerts from "./TerminalAlerts";
import { useTerminalZoom } from "./useTerminalZoom";
import { effectiveFontSize } from "./terminal-zoom";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, RotateCw, Plug, CircleHelp } from "lucide-react";
import { ErrorBox, IconButton, StatusDot } from "./components";
import type { PanelConfig } from "./types";
import { useSettings } from "./SettingsContext";
import { themeId, terminalTheme } from "./themes";
import { localShellLabel } from "./platform";
import { motionReduced } from "./reduced-motion";
import { effectiveScrollback, openTerminalCount, registerTerminal, subscribeTerminals } from "./terminal-budget";
export default function TerminalPanel({
  config,
  onFile,
  onRelaunch,
  seatActivityAvailable = false,
}: {
  config: PanelConfig;
  seatActivityAvailable?: boolean;
  onRelaunch?: () => void;
  onFile: (path: string, line?: number) => void;
}) {
  const { effective: preferences } = useSettings();
  const colorTheme = themeId(preferences);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const localShell = useRef(preferences["terminal.localShell"]).current;
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const zoom = useTerminalZoom(
    panel,
    config.terminalId!,
    preferences["terminal.fontSize"],
  );
  const [error, setError] = useState("");
  const [ended, setEnded] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const retries = useRef(0);
  const [findRequest, setFindRequest] = useState(0);
  const [commandNotice, setCommandNotice] = useState("");
  useEffect(() => { setCommandNotice(""); }, [attempt, ready]);
  useEffect(() => {
    const listener = (event: Event) => {
      const {id, command, text} = (event as CustomEvent).detail;
      if (id !== config.terminalId || config.rigControlToken) return;
      const term = terminalRef.current;
      if (!term) return;
      if (command === "focus") term.focus();
      if (command === "clear") {term.clear();term.focus();}
      if (command === "find") setFindRequest(n => n + 1);
      if (command === "reconnect") {
        void window.hrig.closeTerminal(id).then(() => {retries.current=0;setAttempt(n=>n+1);}).catch(e=>setError(e.message));
      }
      if (command === "insert" || command === "run") {
        const problem = typeof text === "string" ? snippetError(text) : "Invalid snippet.";
        if (problem || !ready || ended !== null) {setCommandNotice(problem || "Terminal is not connected. Nothing was sent.");return;}
        setCommandNotice("");
        term.paste(text);
        if (command === "run") window.hrig.writeTerminal(id,"\r");
        term.focus();
      }
    };
    window.addEventListener("hrig:terminal-command",listener);
    return () => window.removeEventListener("hrig:terminal-command",listener);
  }, [config.terminalId,config.rigControlToken,ready,ended,error]);
  const reconnectButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The PTY is gone, so keystrokes in this terminal go nowhere. Move focus
    // from the dead terminal (or nowhere) to Reconnect so Enter/Space works;
    // leave focus alone if the person is in another panel or field.
    const active = document.activeElement;
    if (
      ended !== null &&
      (!active ||
        active === document.body ||
        host.current?.contains(active))
    )
      reconnectButton.current?.focus();
  }, [ended]);
  useEffect(() => {
    const listener = (event: Event) => {
      const { connectionId, seatId } = (event as CustomEvent).detail;
      if (connectionId === config.connection.id && seatId === config.seat?.id) {
        retries.current = 0;
        setAttempt((n) => n + 1);
      }
    };
    window.addEventListener("hrig:session-relaunched", listener);
    return () =>
      window.removeEventListener("hrig:session-relaunched", listener);
  }, [config.connection.id, config.seat?.id]);
  const previousSession = useRef<string | null | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [inputDropped, setInputDropped] = useState(false);
  // Distance from the live bottom when the last view was torn down, restored
  // only if the session replays its retained buffer on re-attach.
  const savedScroll = useRef(0);
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
    const delay = retryDelay(retries.current++);
    setNextRetryAt(Date.now() + delay);
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
      connected = false,
      attached = false;
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
      cursorBlink: !motionReduced(false),
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
        const links = terminalPathLinks(term.buffer.active, y).map(
          ({ file, line, range }) => {
            return {
              range,
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
          },
        );
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
      // Input while disconnected is dropped, never queued: after an uncertain
      // disconnect, replaying keystrokes could run commands unseen.
      if (connected) window.hrig.writeTerminal(id, data);
      else setInputDropped(true);
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
        attached = true;
        stableTimer = setTimeout(() => {
          if (!disposed && connected) retries.current = 0;
        }, 30000);
        setEnded(null);
        setInputDropped(false);
        setReady(true);
        if (result.buffer) {
          const offset = savedScroll.current;
          savedScroll.current = 0;
          term.write(result.buffer, () => {
            if (!disposed && offset > 0)
              term.scrollToLine(restoreLine(term.buffer.active.baseY, offset));
          });
        }
        else {
          // No retained buffer: the old position no longer refers to anything.
          savedScroll.current = 0;
          pending.forEach((data) => term.write(data));
        }
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
      // Only a view that actually attached holds the scroll position worth
      // keeping; a failed blank attempt must not overwrite it with zero.
      if (attached)
        savedScroll.current = scrollOffset(
          term.buffer.active.baseY,
          term.buffer.active.viewportY,
        );
      term.dispose();
      if (terminalRef.current === term) {
        terminalRef.current = null;
        fitRef.current = null;
      }
    };
  }, [config.terminalId, config.seat?.session, attempt]);
  const [terminalsOpen, setTerminalsOpen] = useState(openTerminalCount);
  useEffect(() => {
    const id = config.terminalId;
    const off = subscribeTerminals(() => setTerminalsOpen(openTerminalCount()));
    const unregister = id ? registerTerminal(id) : () => {};
    setTerminalsOpen(openTerminalCount());
    return () => {
      off();
      unregister();
    };
  }, [config.terminalId]);
  const scrollbackLines = effectiveScrollback(
    preferences["terminal.scrollback"],
    terminalsOpen,
    preferences["terminal.scrollbackBudget"],
  );
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = preferences["terminal.fontFamily"];
    term.options.fontSize = effectiveFontSize(
      preferences["terminal.fontSize"],
      zoom,
    );
    term.options.lineHeight = preferences["terminal.lineHeight"];
    term.options.cursorStyle = preferences["terminal.cursorStyle"] as
      "bar" | "block" | "underline";
    term.options.cursorBlink =
      preferences["terminal.cursorBlink"] &&
      !motionReduced(preferences["appearance.reduceMotion"]);
    term.options.scrollback = scrollbackLines;
    term.options.theme = terminalTheme(preferences, colorTheme);
    try {
      fitRef.current?.fit();
      window.hrig.resizeTerminal(config.terminalId!, term.cols, term.rows);
    } catch {}
  }, [preferences, colorTheme, attempt, config.seat?.session, zoom, scrollbackLines]);
  const activity = terminalSeatActivity(config.seat, seatActivityAvailable);
  return (
    <div className="terminal-panel" ref={panel}>
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
        {activity && (
          <span className="terminal-seat-activity" title={activity.detail} role="status">
            <StatusDot status={activity.status} />
            {activity.label}
          </span>
        )}
        <span className="session-connection">
          <Plug size={11} />
          {config.connection.name}
        </span>
        <StatusDot
          status={ended !== null ? "stopped" : ready ? "idle" : "unknown"}
        />
        {config.seat && onRelaunch && (
          <IconButton title="Relaunch session" onClick={onRelaunch}>
            <RotateCw size={13} />
          </IconButton>
        )}
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
      {commandNotice && <div className="editor-notice" role="status">{commandNotice}</div>}
      <TerminalReconnect
        seat={!!config.seat}
        retrying={retrying}
        retries={retries.current}
        failed={!!error || ended !== null}
        nextAt={nextRetryAt}
        reason={reconnectReason(error, ended)}
        inputDropped={inputDropped}
      />
      <TerminalAlerts
        terminal={terminalRef}
        panel={panel}
        generation={attempt * 2 + (ready ? 1 : 0)}
        bell={
          preferences["notifications.desktop"] &&
          preferences["notifications.terminalBell"]
        }
        quiet={
          preferences["notifications.desktop"] &&
          preferences["notifications.terminalQuiet"]
        }
        label={config.seat?.name || "Shell"}
        host={config.connection.name}
      />
      <TerminalSessionTools terminal={terminalRef} id={config.terminalId!} generation={attempt * 2 + (ready ? 1 : 0)} />
      <TerminalTools
        findRequest={findRequest}
        terminalId={config.terminalId!}
        terminal={terminalRef}
        generation={attempt * 2 + (ready ? 1 : 0)}
      />
      <div className="terminal-stage">
        <div className="terminal-host" ref={host} />
        <TerminalScrollback
          terminal={terminalRef}
          generation={attempt * 2 + (ready ? 1 : 0)}
          scrollback={scrollbackLines}
        />
      </div>
      {ended !== null && (
        <div className="terminal-ended">
          {config.rigControlToken ? (
            `Command finished (exit ${ended}). Review the action again to run it another time.`
          ) : (
            <>
              Connection ended (exit {ended}).{" "}
              <button
                ref={reconnectButton}
                onClick={() => {
                  retries.current = 0;
                  setAttempt((n) => n + 1);
                }}
              >
                Reconnect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
