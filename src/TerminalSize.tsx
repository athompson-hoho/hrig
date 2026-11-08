import { useEffect, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { useSettings } from "./SettingsContext";
import { createSizeIndicator } from "./terminal-size";

/**
 * Overlay (absolutely positioned, so it never resizes the PTY) that briefly
 * shows the terminal's "cols x rows" after a real size change.
 */
export default function TerminalSize({
  terminal,
  generation,
}: {
  terminal: RefObject<Terminal | null>;
  generation: number;
}) {
  const enabled = useSettings().effective["terminal.showSizeOnResize"];
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    setLabel(null);
    if (!enabled) return;
    const term = terminal.current;
    if (!term) return;
    const indicator = createSizeIndicator({
      onShow: setLabel,
      onHide: () => setLabel(null),
    });
    // The initial fit happened before this component could subscribe, so the
    // first report must be the current size, not the first resize event; this
    // also keeps attach, reconnect and layout restore silent.
    indicator.report(term.cols, term.rows);
    const subscription = term.onResize(({ cols, rows }) =>
      indicator.report(cols, rows),
    );
    return () => {
      subscription.dispose();
      indicator.dispose();
    };
  }, [generation, enabled]);
  if (!enabled) return null;
  return (
    <div className="terminal-size" role="status" aria-live="polite">
      {label}
    </div>
  );
}
