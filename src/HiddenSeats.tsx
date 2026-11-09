import { Eye, EyeOff } from "lucide-react";
import { hiddenSeatsText } from "./seat-visibility";

/** The toggle beside SESSIONS. Its name stays the same and aria-pressed says whether stopped sessions are hidden; the tooltip says what a click does. */
export function HideStoppedButton({
  hiding,
  onToggle,
}: {
  hiding: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={hiding}
      aria-label="Hide stopped sessions"
      title={hiding ? "Show stopped sessions" : "Hide stopped sessions"}
      onClick={onToggle}
    >
      {hiding ? <EyeOff size={13} /> : <Eye size={13} />}
    </button>
  );
}

/** The empty list when every matching session is stopped and hidden: how many, and a way back. */
export function HiddenSeatsNotice({
  count,
  onShow,
}: {
  count: number;
  onShow: () => void;
}) {
  return (
    <div className="connection-empty" role="status">
      <EyeOff size={26} />
      <h4>{hiddenSeatsText(count)}</h4>
      <p>
        Stopped, exited and archived sessions are left out of this list. Failed
        sessions and sessions that need input are always shown.
      </p>
      <button className="small-button" onClick={onShow}>
        Show stopped sessions
      </button>
    </div>
  );
}
