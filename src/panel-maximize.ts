/** What a maximize request asks for: the chord toggles, the palette has one command each way. */
export type MaximizeRequest = "toggle" | "maximize" | "restore";

/** What the App knows about the layout window that holds the focused panel group. */
export interface MaximizeView {
  /** The group (a flexlayout tab set) of the focused panel, or null when none has focus. */
  tabsetId: string | null;
  /** The group's own enableMaximize attribute. */
  enabled: boolean;
  /** How many groups that layout window holds. */
  groups: number;
  /** The group that is maximized in that window right now, or null. */
  maximizedId: string | null;
}

/** The only two answers: flip one group's maximize flag, or say why nothing happens. */
export type MaximizePlan =
  | { action: "toggle"; tabsetId: string; maximizing: boolean }
  | { action: "none"; message: string };

function idOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    ? value
    : null;
}

/**
 * Decides which group to toggle. Restoring always targets the group that is
 * maximized now, whichever panel has focus, so the same chord undoes itself.
 * Maximizing needs a focused group that allows it and at least one other
 * group to hide: with a single group flexlayout would accept the toggle but
 * nothing could be hidden, so the plan refuses. Nothing here touches the
 * layout tree; the caller flips the one flag and flexlayout hides the rest.
 */
export function planMaximize(
  request: MaximizeRequest,
  view: MaximizeView,
): MaximizePlan {
  const maximized = idOf(view?.maximizedId);
  if (request === "restore" || (request === "toggle" && maximized !== null)) {
    return maximized === null
      ? { action: "none", message: "Nothing is maximized." }
      : { action: "toggle", tabsetId: maximized, maximizing: false };
  }
  if (request !== "maximize" && request !== "toggle")
    return { action: "none", message: "Nothing to do." };
  if (maximized !== null)
    return {
      action: "none",
      message:
        "A panel group is already maximized. Choose Restore panel layout to show every group again.",
    };
  const tabsetId = idOf(view?.tabsetId);
  if (tabsetId === null)
    return {
      action: "none",
      message: "Click a panel first, then maximize it.",
    };
  if (view.enabled !== true)
    return { action: "none", message: "This panel group cannot be maximized." };
  if (!Number.isInteger(view.groups) || view.groups < 2)
    return {
      action: "none",
      message: "Only one panel group is open, so there is nothing to hide.",
    };
  return { action: "toggle", tabsetId, maximizing: true };
}

/**
 * A new tab is about to be added to `targetId` while `maximizedId` is maximized
 * in the same layout window. In the maximized group it is already visible, so
 * keep; in any hidden group it would be invisible until Restore, so restore
 * first. Anything that is not a usable id (null, undefined, garbage) keeps.
 */
export function planOpenInMaximized(view: {
  maximizedId: string | null | undefined;
  targetId: string | null | undefined;
}): "restore" | "keep" {
  const maximized = idOf(view?.maximizedId);
  const target = idOf(view?.targetId);
  return maximized !== null && target !== null && maximized !== target
    ? "restore"
    : "keep";
}

/**
 * A copy of saved layout JSON without the maximized flag that flexlayout writes
 * on a tab set. Maximizing is a view state for the current session, so a
 * restored, saved or role-template layout always opens with every group
 * visible. Only objects of type tabset lose the key; the input is never
 * changed.
 */
export function withoutMaximized<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutMaximized) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  const source = value as unknown as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (key === "maximized" && source.type === "tabset") continue;
    copy[key] = withoutMaximized(source[key]);
  }
  return copy as unknown as T;
}
