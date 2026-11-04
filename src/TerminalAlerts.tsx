import { useEffect, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import {
  alertText,
  createActivityTracker,
  shouldAlert,
} from "./terminal-activity";

/**
 * Opt-in desktop alerts for a terminal that needs attention while unwatched.
 * Gated on the existing desktop-notification setting; sends only the seat or
 * shell name and host, never terminal text.
 */
export default function TerminalAlerts({
  terminal,
  panel,
  generation,
  bell,
  quiet,
  label,
  host,
}: {
  terminal: RefObject<Terminal | null>;
  panel: RefObject<HTMLElement | null>;
  generation: number;
  bell: boolean;
  quiet: boolean;
  label: string;
  host: string;
}) {
  useEffect(() => {
    const term = terminal.current;
    if (!term || (!bell && !quiet)) return;
    const tracker = createActivityTracker();
    tracker.attach(Date.now());
    const watching = () =>
      !shouldAlert(
        document.hasFocus(),
        !!panel.current?.contains(document.activeElement),
      );
    const send = (kind: "bell" | "quiet") => {
      const text = alertText(kind, label, host);
      void window.hrig.notifyAttention(text.title, text.body).catch(() => {});
    };
    let lineFeeds = 0;
    const subscriptions = [
      term.onLineFeed(() => lineFeeds++),
      term.onWriteParsed(() => {
        tracker.output(Date.now(), lineFeeds);
        lineFeeds = 0;
      }),
      term.onBell(() => {
        if (bell && !watching() && tracker.bell(Date.now())) send("bell");
      }),
    ];
    const timer = quiet
      ? setInterval(() => {
          if (tracker.tick(Date.now()) && !watching()) send("quiet");
        }, 1000)
      : undefined;
    return () => {
      subscriptions.forEach((s) => s.dispose());
      clearInterval(timer);
    };
  }, [generation, bell, quiet, label, host]);
  return null;
}
