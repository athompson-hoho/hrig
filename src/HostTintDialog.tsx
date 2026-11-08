import { useState } from "react";
import { Modal } from "./components";
import {
  MAX_TINT_LABEL,
  TINT_COLORS,
  normalizeHostTints,
  resolveHostTint,
  setHostTint,
  type HostTints,
} from "./host-tint";
import type { Connection } from "./types";

type Row = { id: string; name: string; label: string; color: string };

/**
 * Sets a short label and a palette color for each saved connection. Edits stay
 * in the dialog until Save; nothing is sent to any terminal, host or seat.
 */
export default function HostTintDialog({
  connections,
  tints,
  onSave,
  onClose,
}: {
  connections: Connection[];
  tints: HostTints | undefined;
  onSave: (next: HostTints) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    connections.map((c) => {
      const tint = resolveHostTint(c, tints);
      return {
        id: c.id,
        name: c.name,
        label: tint?.label ?? "",
        color: tint?.color ?? "",
      };
    }),
  );
  const change = (id: string, patch: Partial<Row>) =>
    setRows((old) => old.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const save = () =>
    onSave(
      rows.reduce(
        (map, r) => setHostTint(map, r.id, { label: r.label, color: r.color }),
        normalizeHostTints(tints),
      ),
    );
  return (
    <Modal
      title="Host label and tint"
      subtitle="Mark a host, for example production or development, with a short label and a thin colored line in the header of its terminals. Leave a row empty for no mark. Nothing is sent to a terminal or host."
      onClose={onClose}
    >
      <div className="host-tint-rows">
        {rows.map((row) => (
          <div className="host-tint-row" key={row.id}>
            <span className="host-tint-name" title={row.name}>
              {row.name}
            </span>
            <input
              aria-label={"Label for " + row.name}
              placeholder="Label, for example PROD"
              maxLength={MAX_TINT_LABEL}
              value={row.label}
              onChange={(e) => change(row.id, { label: e.target.value })}
            />
            <select
              aria-label={"Tint for " + row.name}
              value={row.color}
              onChange={(e) => change(row.id, { color: e.target.value })}
            >
              <option value="">No tint</option>
              {Object.keys(TINT_COLORS).map((name) => (
                <option key={name} value={name}>
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
