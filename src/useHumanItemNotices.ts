import { useEffect, useRef } from "react";
import type { Connection } from "./types";
import { NO_SEEN, nextHumanPoll, type HumanSeen } from "./human-items";

/**
 * Opt-in desktop notification for new queue items addressed to a person.
 * Reads the queue list the app already reads (window.hrig.queue, read only)
 * every intervalSeconds while enabled, and tells the person through the
 * existing attention notification. It never changes a row and sends nothing
 * to a seat or shell. The first answer on a connection only seeds what is
 * already there; a failed read is skipped and tried again on the next tick.
 */
export function useHumanItemNotices(options: {
  enabled: boolean;
  connection: Connection;
  intervalSeconds: number;
  refresh: number;
  log: (text: string) => void;
}) {
  const { enabled, connection, intervalSeconds, refresh, log } = options;
  const seen = useRef<HumanSeen>(NO_SEEN);
  const logRef = useRef(log);
  logRef.current = log;
  useEffect(() => {
    if (!enabled) {
      seen.current = NO_SEEN;
      return;
    }
    const key = JSON.stringify([
      connection.id,
      connection.kind,
      connection.host,
      connection.port,
      connection.distro,
      connection.rigBinary,
    ]);
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!active) return;
      try {
        const rows = await window.hrig.queue(connection);
        if (!active) return;
        const step = nextHumanPoll(seen.current, key, rows);
        seen.current = step.seen;
        if (step.notice) {
          void window.hrig
            .notifyAttention(step.notice.title, step.notice.body)
            .catch(() => {});
          logRef.current(step.notice.entry);
        }
      } catch {
        // A failed read is skipped; the next tick tries again.
      } finally {
        if (active) timer = setTimeout(tick, intervalSeconds * 1000);
      }
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    enabled,
    connection.id,
    connection.kind,
    connection.host,
    connection.port,
    connection.distro,
    connection.rigBinary,
    intervalSeconds,
    refresh,
  ]);
}
