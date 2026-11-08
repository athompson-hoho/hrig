import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { useSettings } from "./SettingsContext";
import {
  BELL_COOLDOWN_MS,
  BELL_FLASH_MS,
  bellSettled,
  shouldFlash,
} from "./terminal-bell";

/**
 * Optional visual bell: an absolutely positioned overlay that never resizes the
 * PTY or shifts the layout. It listens only to the bell event, so nothing is
 * sent to the shell, and it is independent of the desktop notification raised
 * by TerminalAlerts.
 */
export default function TerminalBell({
  terminal,
  generation,
}: {
  terminal: RefObject<Terminal | null>;
  generation: number;
}) {
  const style = useSettings().effective["terminal.bellStyle"];
  // Read through a ref so changing the setting never restarts the settle window.
  const styleRef = useRef(style);
  styleRef.current = style;
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    setFlashing(false);
    const term = terminal.current;
    if (!term) return;
    const attachedAt = performance.now();
    let lastFlash = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = term.onBell(() => {
      const now = performance.now();
      if (!bellSettled(now, attachedAt)) return;
      if (!shouldFlash(styleRef.current, now, lastFlash, BELL_COOLDOWN_MS))
        return;
      lastFlash = now;
      setFlashing(true);
      clearTimeout(timer);
      timer = setTimeout(() => setFlashing(false), BELL_FLASH_MS);
    });
    return () => {
      subscription.dispose();
      clearTimeout(timer);
    };
  }, [generation]);
  if (style !== "visual" || !flashing) return null;
  return <div className="terminal-bell-flash" aria-hidden="true" />;
}
