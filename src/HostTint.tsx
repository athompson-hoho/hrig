import { createContext, useContext, type CSSProperties } from "react";
import {
  resolveHostTint,
  tintColor,
  type HostTint,
  type HostTints,
} from "./host-tint";

/** The saved host tints, provided once by the app; undefined or empty means nothing is tinted. */
export const HostTintContext = createContext<HostTints | undefined>(undefined);

/** The tint saved for this connection, or null (the default: the header looks as it always did). */
export function useHostTint(connection: unknown): HostTint | null {
  return resolveHostTint(connection, useContext(HostTintContext));
}

/** The header style that carries the tint color as a CSS variable; undefined without a color so nothing is added. */
export function hostTintStyle(
  tint: HostTint | null | undefined,
): CSSProperties | undefined {
  const color = tintColor(tint);
  return color ? ({ "--host-tint": color } as CSSProperties) : undefined;
}

/** The small host label in the terminal header, or nothing when there is no label. */
export function HostTintLabel({ tint }: { tint: HostTint | null | undefined }) {
  if (!tint?.label) return null;
  return (
    <span className="host-tint-label" title={"Host label: " + tint.label}>
      {tint.label}
    </span>
  );
}
