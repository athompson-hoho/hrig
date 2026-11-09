import { Activity } from "lucide-react";
import type { Inventory } from "./types";
import { rigHealthSummary } from "./rig-health";

/** Working / idle / attention counts for the selected rig (or all rigs) in the status bar. */
export default function RigHealthStatus({
  scope,
  rigId,
  onOpen,
}: {
  scope: { inventory: Inventory | null; ready: boolean };
  rigId: string;
  onOpen: () => void;
}) {
  const { inventory, ready } = scope;
  const rig = rigId ? inventory?.rigs.find((r) => r.id === rigId) : undefined;
  const scopeName = rigId ? rig?.name || "Selected rig" : "All rigs";
  const seats = inventory ? inventory.seats.filter((s) => !rigId || s.rigId === rigId) : null;
  const health = rigHealthSummary(seats, scopeName, ready, !!rigId && !!inventory && !rig);
  return (
    <button
      type="button"
      className="rig-health-status"
      onClick={onOpen}
      aria-label={health.detail}
      title={health.detail}
    >
      <Activity size={11} aria-hidden="true" />
      <span className="rig-health-summary">{health.text}</span>
    </button>
  );
}
