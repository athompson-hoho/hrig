import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import {
  MAX_RETRIES,
  reconnectView,
  type ReconnectView,
} from "./terminal-reconnect";

/**
 * Status overlay for a seat terminal that is reconnecting. It floats over the
 * terminal so appearing never resizes the PTY. Reconnect itself stays an
 * explicit button elsewhere; nothing here sends input.
 */
export default function TerminalReconnect({
  seat,
  retrying,
  retries,
  failed,
  nextAt,
  reason,
  inputDropped,
}: {
  seat: boolean;
  retrying: boolean;
  retries: number;
  failed: boolean;
  nextAt: number | null;
  reason: string;
  inputDropped: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!retrying) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [retrying, nextAt]);
  const view: ReconnectView = reconnectView({
    seat,
    retrying,
    retries,
    failed,
    nextAt,
    now,
  });
  if (!view && !(failed && inputDropped)) return null;
  return (
    <div className="terminal-status-overlay" role="status">
      {view?.kind === "retrying" && (
        <div>
          <Plug size={12} /> Reconnecting to the existing seat · attempt{" "}
          {view.attempt} of {MAX_RETRIES}
          {view.seconds > 0 ? ` · next try in ${view.seconds}s` : " · trying now"}
        </div>
      )}
      {view?.kind === "paused" && (
        <div>
          <Plug size={12} /> Automatic retries paused. Use Reconnect when the
          host is ready.
        </div>
      )}
      {reason && view && <small>{reason}</small>}
      {inputDropped && (
        <small>
          Keys typed while disconnected are not sent and are never replayed.
        </small>
      )}
    </div>
  );
}
