import { useEffect, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { ArrowDownToLine, X } from "lucide-react";
import {
  discardNotice,
  isScrolledUp,
  scrollbackFull,
} from "./terminal-scrollback";

/**
 * Overlay (absolutely positioned, so it never resizes the PTY) that offers a
 * jump to live output and reports output discarded by the scrollback limit.
 */
export default function TerminalScrollback({
  terminal,
  generation,
  scrollback,
}: {
  terminal: RefObject<Terminal | null>;
  generation: number;
  scrollback: number;
}) {
  const [up, setUp] = useState(false);
  const [dropped, setDropped] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const sync = () => {
      const buffer = term.buffer.active;
      setUp(isScrolledUp(buffer.viewportY, buffer.baseY));
    };
    const subscriptions = [
      term.onScroll(sync),
      term.onWriteParsed(sync),
      term.onResize(sync),
      // A line feed in a full normal buffer pushes the oldest line out.
      term.onLineFeed(() => {
        const buffer = term.buffer.active;
        if (
          buffer.type === "normal" &&
          scrollbackFull(buffer.length, term.rows, term.options.scrollback ?? 0)
        )
          setDropped(true);
      }),
    ];
    sync();
    return () => subscriptions.forEach((s) => s.dispose());
  }, [generation]);
  const showNotice = dropped && !dismissed;
  if (!up && !showNotice) return null;
  return (
    <div className="terminal-overlay">
      {showNotice && (
        <div className="terminal-overlay-notice" role="status">
          {discardNotice(scrollback)}
          <button
            aria-label="Dismiss scrollback notice"
            onClick={() => setDismissed(true)}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {up && (
        <button
          className="terminal-jump"
          onClick={() => {
            terminal.current?.scrollToBottom();
            terminal.current?.focus();
          }}
        >
          <ArrowDownToLine size={13} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
