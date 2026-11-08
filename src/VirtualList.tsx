import { cloneElement, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, Ref } from "react";
import { prefixOffsets, viewportRange } from "./virtual-range";

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
function MeasuredRow({ element, onSize }: { element: ReactElement<any>; onSize: (height: number) => void }) {
  const node = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const target = node.current;
    if (!target) return;
    let active = true;
    const measure = () => {
      if (active) onSize(target.getBoundingClientRect().height);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    measure();
    return () => { active = false; observer.disconnect(); };
  }, [element, onSize]);
  return cloneElement(element, { ref: (target: HTMLElement | null) => {
    node.current = target;
    return assignRef(element.props.ref, target);
  } });
}

export function VirtualList<T>(props: Props<T>) {
  // A different owner/result generation cannot inherit old nodes or geometry.
  return <Viewport key={props.scopeKey} {...props} />;
}

function Viewport<T>({ rows, itemKey, renderRow, label, estimateHeight = 55, maxHeight = 330, className }: Props<T>) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const sizes = useRef(new Map<string, number>());
  const [, changed] = useState(0);
  const [geometry, setGeometry] = useState({ top: 0, height: 0 });
  const keys = rows.map(itemKey);
  const currentKeys = new Set(keys);
  for (const key of sizes.current.keys()) if (!currentKeys.has(key)) sizes.current.delete(key);
  const offsets = prefixOffsets(keys.map(key => sizes.current.get(key) ?? estimateHeight), estimateHeight);
  const range = viewportRange(offsets, geometry.top, geometry.height);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const height = Number.isFinite(node.clientHeight) ? Math.max(0, node.clientHeight) : 0;
      setGeometry(old => old.height === height ? old : { ...old, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => { active = false; observer.disconnect(); };
  }, []);

  useLayoutEffect(() => {
    if (viewport.current && viewport.current.scrollTop !== range.scrollTop) viewport.current.scrollTop = range.scrollTop;
  }, [range.scrollTop]);

  const spacer = (key: string, height: number) => height > 0
    ? <div key={key} aria-hidden="true" style={{ height, pointerEvents: "none" }} /> : null;
  return <div ref={viewport} className={className} aria-label={label} tabIndex={0}
    style={{ maxHeight, overflow: "auto", overflowAnchor: "none" }}
    onScroll={event => {
      const top = event.currentTarget.scrollTop;
      setGeometry(old => old.top === top ? old : { ...old, top });
    }}>
    {spacer("before", offsets[range.start])}
    {rows.slice(range.start, range.end).map((row, local) => {
      const index = range.start + local, key = keys[index];
      return <MeasuredRow key={key} element={renderRow(row, index)} onSize={height => {
        if (Number.isFinite(height) && height > 0 && sizes.current.get(key) !== height) {
          sizes.current.set(key, height);
          changed(value => value + 1);
        }
      }} />;
    })}
    {rows.length > 0 && spacer("after", offsets[rows.length] - offsets[range.end])}
  </div>;
}
