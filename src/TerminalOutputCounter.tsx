import { useEffect, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { useSettings } from "./SettingsContext";
import { classifyTerminalKey } from "./terminal-keys";
import {
  createCounter,
  createThrottle,
  format,
} from "./terminal-output-counter";

/**
 * Opt-in diagnostics overlay (absolutely positioned, so it never resizes the
 * PTY) that shows how many lines and bytes of output this terminal has received
 * since it attached or was last cleared. It subscribes to the terminal data
 * events only while the setting is on, keeps two numbers and never the output,
 * updates at most four times a second, and sends nothing to the shell.
 */
export default function TerminalOutputCounter({
  terminal,
  id,
  generation,
}: {
  terminal: RefObject<Terminal | null>;
  id: string;
  generation: number;
}) {
  const enabled = useSettings().effective["terminal.showOutputCounter"];
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(null);
    if (!enabled) return;
    const term = terminal.current;
    if (!term) return;
    const counter = createCounter();
    const throttle = createThrottle({
      now: () => performance.now(),
      schedule: (run, ms) => setTimeout(run, ms),
      unschedule: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
      publish: () => setLabel(format(counter.snapshot())),
    });
    throttle.notify();
    const unsubscribe = window.hrig.onTerminal((event) => {
      if (event.id !== id || typeof event.data !== "string") return;
      counter.add(event.data);
      throttle.notify();
    });
    const restart = () => {
      counter.reset();
      throttle.notify();
    };
    // Clear from the command center arrives as a window event.
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && detail.id === id && detail.command === "clear") restart();
    };
    // Clear from the keyboard is handled by TerminalTools; this sees the same
    // key first (capture) and decides with the same classifier.
    const onKeyDown = (event: KeyboardEvent) => {
      if (classifyTerminalKey(event, window.hrig.platform, false) === "clear")
        restart();
    };
    window.addEventListener("hrig:terminal-command", onCommand);
    term.element?.addEventListener("keydown", onKeyDown, true);
    return () => {
      unsubscribe();
      window.removeEventListener("hrig:terminal-command", onCommand);
      term.element?.removeEventListener("keydown", onKeyDown, true);
      throttle.dispose();
    };
  }, [generation, enabled, id]);
  if (!enabled || label === null) return null;
  return (
    <div
      className="terminal-size terminal-output-counter"
      role="status"
      aria-live="off"
      title="Output received since this terminal attached. Lines count line feeds; size is UTF-8 bytes. Clear or reconnect starts again from zero."
    >
      {label}
    </div>
  );
}
