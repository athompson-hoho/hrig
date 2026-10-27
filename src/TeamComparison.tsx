import { useEffect, useRef } from "react";
import type { DesignSeat } from "./types";
import { compareTeamSeats } from "./team-tuning";
import HandoffPlan from "./HandoffPlan";

export default function TeamComparison({
  tier,
  before,
  after,
  protectedIds,
  onApply,
  onCancel,
}: {
  tier: string;
  before: DesignSeat[];
  after: DesignSeat[];
  protectedIds: string[];
  onApply: () => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const diff = compareTeamSeats(before, after);
  return (
    <section
      className="team-comparison"
      aria-label={`Review ${tier} team changes`}
    >
      <h4 ref={heading} tabIndex={-1}>
        Review {tier} team changes
      </h4>
      <p>
        {diff.added.length} added · {diff.removed.length} removed ·{" "}
        {diff.changed.length} changed · {diff.unchanged.length} unchanged
      </p>
      <p>
        This updates the wizard’s draft. Review and preview the resulting design
        before launching.
      </p>
      {!!protectedIds.length && (
        <p>
          Protected edits retained: <strong>{protectedIds.join(", ")}</strong>.
          This comparison shows the final team after edit protection.
        </p>
      )}
      {diff.hubBefore !== diff.hubAfter && (
        <p title="The first seat is the hub for the designer’s collaboration links.">
          <strong>Coordination hub:</strong> {diff.hubBefore} → {diff.hubAfter}
        </p>
      )}
      {diff.added.map((seat) => (
        <article key={seat.id}>
          <h5>{seat.id} — Added to draft</h5>
          <p>
            Agent: {seat.agentId} · Runtime: {seat.runtime}
          </p>
          <HandoffPlan seat={seat.id} plan={seat.firstHandoff} />
        </article>
      ))}
      {diff.removed.map((seat) => (
        <article key={seat.id}>
          <h5>{seat.id} — Removed from draft</h5>
          <p>
            Agent: {seat.agentId} · Runtime: {seat.runtime}
          </p>
          <HandoffPlan seat={seat.id} plan={seat.firstHandoff} />
        </article>
      ))}
      {diff.changed.map(({ seat, changes }) => (
        <article key={seat.id}>
          <h5>{seat.id} — Changed</h5>
          <table className="team-comparison-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Current draft</th>
                <th>Reviewed draft</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.label}>
                  <th scope="row">{change.label}</th>
                  <td>{change.before || "Not supplied"}</td>
                  <td>{change.after || "Not supplied"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
      {!!diff.unchanged.length && (
        <details>
          <summary>Unchanged seats ({diff.unchanged.length})</summary>
          <ul>
            {diff.unchanged.map((seat) => (
              <li key={seat.id}>
                {seat.id} · {seat.agentId} · {seat.runtime}
                <HandoffPlan seat={seat.id} plan={seat.firstHandoff} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {!diff.added.length && !diff.removed.length && !diff.changed.length && (
        <p>
          No seat or handoff changes. Applying this recommendation updates its
          rationale in the wizard.
        </p>
      )}
      <p className="field-note">
        Seats are matched by name. A new name appears as an addition and
        removal. Position changes are included because the first seat defines
        the coordination hub.
      </p>
      <div className="arrange-controls">
        <button
          className="primary-button"
          onClick={onApply}
          title="Apply exactly the reviewed merged team to the wizard draft"
        >
          Apply {tier} team
        </button>
        <button
          className="secondary-button"
          onClick={onCancel}
          title="Keep the current draft and dismiss this comparison"
        >
          Cancel comparison
        </button>
      </div>
    </section>
  );
}
