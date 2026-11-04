import { useEffect, useRef, useState, type RefObject } from "react";
import {
  nextOffset,
  wheelSteps,
  zoomAction,
} from "./terminal-zoom";

// Survives panel moves and reconnects; the Settings font size is untouched.
const offsets = new Map<string, number>();

/**
 * Per-terminal font zoom (Ctrl/Cmd +, -, 0 and Ctrl+wheel). Listeners sit on
 * the panel in the capture phase so xterm never sees the keys.
 */
export function useTerminalZoom(
  panel: RefObject<HTMLElement | null>,
  terminalId: string,
  base: number,
) {
  const [offset, setOffset] = useState(() => offsets.get(terminalId) ?? 0);
  const baseRef = useRef(base);
  baseRef.current = base;
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let wheel = 0;
    const apply = (steps: number, action?: "reset") =>
      setOffset((current) => {
        let next = current;
        if (action === "reset") next = 0;
        else
          for (let i = 0; i < Math.abs(steps); i++)
            next = nextOffset(baseRef.current, next, steps > 0 ? "in" : "out");
        offsets.set(terminalId, next);
        return next;
      });
    const key = (event: KeyboardEvent) => {
      const action = zoomAction(event);
      if (!action || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "keydown")
        apply(action === "in" ? 1 : -1, action === "reset" ? "reset" : undefined);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const { steps, remainder } = wheelSteps(wheel, event.deltaY);
      wheel = remainder;
      if (steps) apply(steps);
    };
    el.addEventListener("keydown", key, true);
    el.addEventListener("keyup", key, true);
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      el.removeEventListener("keydown", key, true);
      el.removeEventListener("keyup", key, true);
      el.removeEventListener("wheel", onWheel, true);
    };
  }, [terminalId]);
  return offset;
}
