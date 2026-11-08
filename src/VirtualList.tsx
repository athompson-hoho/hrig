import { cloneElement, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, Ref } from "react";
import { prefixOffsets, sparseRetainedIndices, viewportRange } from "./virtual-range";

type Props<T> = {
  rows: readonly T[];
  itemKey: (row: T, index: number) => string;
  renderRow: (row: T, index: number) => ReactElement<any>;
  label: string;
  scopeKey: string;
  estimateHeight?: number;
  maxHeight?: number;
  className?: string;
};

function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (typeof ref === "function") return ref(node);
  if (ref) ref.current = node;
}

// Attach measurement to the consumer's native root, keeping direct-child CSS
// and all its original action handlers. No fixed row height or text clipping.
function MeasuredRow({ element, onSize, register }: { element: ReactElement<any>; onSize: (height: number) => void; register: (node: HTMLElement | null) => void }) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef(onSize);
  latest.current = onSize;
  useLayoutEffect(() => {
    const target = node.current;
    if (!target) return;
    let active = true;
    const measure = () => {
      if (active) {
        const style = typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
        latest.current(target.getBoundingClientRect().height + (parseFloat(style?.marginTop || "0") || 0) + (parseFloat(style?.marginBottom || "0") || 0));
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    measure();
    return () => { active = false; observer.disconnect(); };
  }, []);
  return cloneElement(element, { ref: (target: HTMLElement | null) => {
    node.current = target;
    register(target);
    const cleanup = assignRef(element.props.ref, target);
    if (target) return () => {
      node.current = null;
      register(null);
      if (typeof cleanup === "function") cleanup();
      else assignRef(element.props.ref, null);
    };
  } });
}

export function VirtualList<T>(props: Props<T>) {
  // A different owner/result generation cannot inherit old nodes or geometry.
  const restore = useRef<Element | null>(null);
  return <Viewport key={props.scopeKey} {...props} restore={restore} />;
}

function Viewport<T>({ rows, itemKey, renderRow, label, estimateHeight = 55, maxHeight = 330, className, restore }: Props<T> & { restore: { current: Element | null } }) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const sizes = useRef(new Map<string, number>());
  const [, changed] = useState(0);
  const [geometry, setGeometry] = useState({ top: 0, height: 0 });
  const help = useId();
  const nodes = useRef(new Map<string, HTMLElement>());
  const focused = useRef<{ key: string; node: HTMLElement } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [position, setPosition] = useState("");
  const cursor = useRef(0);
  const pending = useRef<{ index: number; direction: number; last: boolean } | null>(null);
  const keys = rows.map(itemKey);
  const currentKeys = new Set(keys);
  for (const key of sizes.current.keys()) if (!currentKeys.has(key)) sizes.current.delete(key);
  const offsets = prefixOffsets(keys.map(key => sizes.current.get(key) ?? estimateHeight), estimateHeight);
  const range = viewportRange(offsets, geometry.top, geometry.height);
  const snapshot = useRef({ keys, offsets, range });
  snapshot.current = { keys, offsets, range };
  const indices = sparseRetainedIndices(range, keys.indexOf(focusKey || ""), keys.indexOf(dragKey || ""), rows.length);
  const controls = (node: HTMLElement) => {
    const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const children = Array.from(node.querySelectorAll<HTMLElement>(selector));
    if (typeof node.matches === "function" && node.matches(selector)) children.unshift(node);
    // The controlled DOM also represents native roots directly.
    else if (node.getAttribute("disabled") === null && node.getAttribute("type") !== "hidden" && node.tagName === "BUTTON") children.unshift(node);
    return children.filter(child => !child.hidden && child.getAttribute("aria-hidden") !== "true");
  };
  const rowIndex = (target: EventTarget | null) => keys.findIndex(key => nodes.current.get(key)?.contains(target as Node));
  const navigate = (index: number, direction: number, last = false) => {
    if (index < 0 || index >= rows.length) return;
    pending.current = { index, direction, last };
    const top = offsets[index];
    setGeometry(old => ({ ...old, top }));
    changed(value => value + 1);
  };

  useLayoutEffect(() => {
    const oldFocus = focused.current;
    if (oldFocus && !currentKeys.has(oldFocus.key)) {
      if (document.activeElement === oldFocus.node) viewport.current?.focus();
      focused.current = null;
      setFocusKey(null);
    }
    if (dragKey && !currentKeys.has(dragKey)) setDragKey(null);
    const request = pending.current;
    if (!request) return;
    const node = nodes.current.get(keys[request.index]);
    if (!node) return;
    const enabled = controls(node);
    if (enabled.length) {
      const target = enabled[request.last ? enabled.length - 1 : 0];
      pending.current = null;
      cursor.current = request.index;
      focused.current = { key: keys[request.index], node: target };
      setFocusKey(keys[request.index]);
      setPosition(`Rows ${request.index + 1}–${request.index + 1} of ${rows.length}`);
      target.focus({ preventScroll: true });
    } else {
      pending.current = null;
      const next = request.index + request.direction;
      if (next >= 0 && next < rows.length) navigate(next, request.direction, request.last);
      else viewport.current?.focus();
    }
  });

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (restore.current && document.activeElement === restore.current) node.focus();
    restore.current = null;
    let active = true;
    let width = node.clientWidth;
    const measure = () => {
      if (!active) return;
      if (node.clientWidth !== width) {
        width = node.clientWidth;
        const current = snapshot.current;
        const anchor = current.range.visibleStart;
        const within = current.range.scrollTop - current.offsets[anchor];
        // Width can change wrapping for unmounted rows too. Re-estimate those
        // extents, retaining the current top key and its fractional offset.
        for (const key of sizes.current.keys()) if (!nodes.current.has(key)) sizes.current.delete(key);
        const next = prefixOffsets(current.keys.map(key => sizes.current.get(key) ?? estimateHeight), estimateHeight);
        setGeometry(old => ({ ...old, top: (next[anchor] || 0) + within }));
      }
      const height = Number.isFinite(node.clientHeight) ? Math.max(0, node.clientHeight) : 0;
      setGeometry(old => old.height === height ? old : { ...old, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => {
      if (node.contains(document.activeElement)) restore.current = document.activeElement;
      active = false;
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (viewport.current && viewport.current.scrollTop !== range.scrollTop) viewport.current.scrollTop = range.scrollTop;
  }, [range.scrollTop]);

  const spacer = (key: string, height: number) => height > 0
    ? <div key={key} aria-hidden="true" style={{ height, pointerEvents: "none" }} /> : null;
  let previousEnd = 0;
  const rendered = indices.flatMap(index => {
    const key = keys[index], before = spacer(`gap-${key}`, offsets[index] - offsets[previousEnd]);
    previousEnd = index + 1;
    return [before, <MeasuredRow key={key} element={renderRow(rows[index], index)} register={node => {
      if (node) nodes.current.set(key, node); else nodes.current.delete(key);
    }} onSize={height => {
      if (!currentKeys.has(key) || !Number.isFinite(height) || height <= 0 || sizes.current.get(key) === height) return;
      const oldHeight = offsets[index + 1] - offsets[index];
      sizes.current.set(key, height);
      if (index < range.visibleStart) setGeometry(old => ({ ...old, top: old.top + height - oldHeight }));
      changed(value => value + 1);
    }} />];
  });
  return <div ref={viewport} className={`virtual-list ${className || ""}`} role="region" aria-label={label} aria-describedby={help} tabIndex={0}
    style={{ maxHeight, overflow: "auto", overflowAnchor: "none" }}
    onFocusCapture={event => {
      const index = rowIndex(event.target);
      if (index >= 0) {
        focused.current = { key: keys[index], node: event.target as HTMLElement };
        setFocusKey(keys[index]);
      }
    }}
    onBlurCapture={event => {
      const index = rowIndex(event.relatedTarget);
      if (index < 0) { focused.current = null; setFocusKey(null); }
    }}
    onDragStartCapture={event => {
      const index = rowIndex(event.target);
      if (index >= 0) setDragKey(keys[index]);
    }}
    onDragEndCapture={() => setDragKey(null)} onDropCapture={() => setDragKey(null)}
    onKeyDown={event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target === event.currentTarget) {
        const page = Math.max(1, range.visibleEnd - range.visibleStart);
        const target = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
          : event.key === "ArrowDown" ? cursor.current + 1 : event.key === "ArrowUp" ? cursor.current - 1
          : event.key === "PageDown" ? cursor.current + page : event.key === "PageUp" ? cursor.current - page : null;
        if (target !== null && rows.length) {
          event.preventDefault();
          navigate(Math.max(0, Math.min(rows.length - 1, target)), event.key === "End" || event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 1);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const index = rowIndex(event.target);
      if (index < 0) return;
      const enabled = controls(nodes.current.get(keys[index])!);
      const position = enabled.indexOf(event.target as HTMLElement);
      if (position < 0 || position !== (event.shiftKey ? 0 : enabled.length - 1)) return;
      const direction = event.shiftKey ? -1 : 1, next = index + direction;
      if (next < 0 || next >= rows.length) return;
      if (nodes.current.has(keys[next]) && controls(nodes.current.get(keys[next])!).length) return;
      event.preventDefault();
      navigate(next, direction, event.shiftKey);
    }}
    onScroll={event => {
      const top = event.currentTarget.scrollTop;
      setGeometry(old => old.top === top ? old : { ...old, top });
    }}>
    <span id={help} className="virtual-list-help">Focus the list to use Arrow keys, Page Up/Down, Home or End. Tab moves through row actions.</span>
    <span className="virtual-list-help" aria-live="polite">{position}</span>
    {rendered}
    {rows.length > 0 && spacer("after", offsets[rows.length] - offsets[previousEnd])}
  </div>;
}
