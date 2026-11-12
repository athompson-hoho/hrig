import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle, AlertCircle } from "lucide-react";
import { isFocusable, nextFocusIndex, type FocusCandidate } from "./focus-trap";
export function IconButton({
  title,
  children,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}${className ? " " + className : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
const TABBABLE = "button,input,select,textarea,summary,a[href],[tabindex]";
/** What the Tab trap needs to know about one element of the dialog. */
const describe = (el: HTMLElement): FocusCandidate => {
  const given = el.getAttribute("tabindex");
  return {
    tag: el.tagName,
    disabled: el.matches(":disabled"),
    hidden: el.hidden || el.offsetParent === null,
    tabIndex: given === null ? null : Number.parseInt(given, 10),
    hasHref: el.hasAttribute("href"),
  };
};
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    (
      ref.current?.querySelector<HTMLElement>("input,select,textarea") ||
      ref.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const found = ref.current?.querySelectorAll<HTMLElement>(TABBABLE);
        if (!found?.length) return;
        const els = Array.from(found).filter((el) => isFocusable(describe(el)));
        const active = document.activeElement;
        const at = els.findIndex((el) => el === active);
        // Focus on something inside the dialog that Tab does not list, such as a container given tabindex -1, is left to the browser.
        if (at < 0 && active && dialog?.contains(active)) return;
        const target = nextFocusIndex(els.length, at, event.shiftKey);
        if (target < 0) return;
        event.preventDefault();
        els[target].focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      const active = document.activeElement;
      // Respect a destination that an action already focused outside this dialog.
      if (!active || active === document.body || dialog?.contains(active)) previous?.focus();
    };
  }, [title]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton title="Close dialog" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="panel-empty" role="status">
      <LoaderCircle size={22} className="spin" />
      <span>{text}</span>
    </div>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={15} />
      <span>{error}</span>
    </div>
  );
}
export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot ${status}`} title={status} />;
}
export function Empty({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-empty">
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
