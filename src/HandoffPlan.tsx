import type { FirstHandoff } from "./types";

export const handoffFields: { key: keyof FirstHandoff; label: string }[] = [
  { key: "mission", label: "Mission" },
  { key: "boundaries", label: "Boundaries and escalation" },
  { key: "expectedOutput", label: "Expected output and evidence" },
  { key: "handoff", label: "Handoff condition and recipient" },
];
export function validHandoff(plan?: FirstHandoff) {
  return (
    !plan ||
    handoffFields.every(
      ({ key }) => plan[key].trim().length > 0 && plan[key].length <= 1000,
    )
  );
}
export default function HandoffPlan({
  seat,
  plan,
  onChange,
}: {
  seat: string;
  plan?: FirstHandoff;
  onChange?: (plan: FirstHandoff | undefined) => void;
}) {
  return (
    <details className="handoff-plan">
      <summary>First handoff for {seat || "unnamed seat"}</summary>
      {!plan ? (
        <>
          <p>
            No handoff plan supplied. Define the first task before work begins.
          </p>
          {onChange && (
            <button
              className="secondary-button"
              onClick={() =>
                onChange({
                  mission: "",
                  boundaries: "",
                  expectedOutput: "",
                  handoff: "",
                })
              }
            >
              Add handoff plan
            </button>
          )}
        </>
      ) : (
        <>
          {handoffFields.map(({ key, label }) =>
            onChange ? (
              <label className="field-label" key={key}>
                {label}
                <textarea
                  aria-label={`${seat} ${label}`}
                  rows={2}
                  maxLength={1000}
                  value={plan[key]}
                  onChange={(e) => onChange({ ...plan, [key]: e.target.value })}
                />
              </label>
            ) : (
              <p key={key}>
                <strong>{label}:</strong> {plan[key]}
              </p>
            ),
          )}
          {onChange && (
            <button
              className="secondary-button"
              onClick={() => onChange(undefined)}
            >
              Remove handoff plan
            </button>
          )}
        </>
      )}
    </details>
  );
}
