import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle, AlertCircle } from "lucide-react";
export function IconButton({
  title,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
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
        const els = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      previous?.focus();
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
    <div className="panel-empty">
      <LoaderCircle size={22} className="spin" />
      <span>{text}</span>
    </div>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="error-box">
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
