import { useMemo } from "react";
const label = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="field-note">None</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value !== "object")
    return <span className="rig-result-value">{String(value)}</span>;
  if (depth >= 4)
    return (
      <details>
        <summary title="Expand this nested value">Nested details</summary>
        <span className="rig-result-value">{JSON.stringify(value)}</span>
      </details>
    );
  if (Array.isArray(value)) {
    if (!value.length) return <span className="field-note">No items</span>;
    const rows = value.slice(0, 100);
    if (
      rows.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ) {
      const columns = [
        ...new Set(rows.flatMap((row) => Object.keys(row))),
      ].slice(0, 8);
      return (
        <>
          <div className="rig-result-scroll">
            <table className="rig-result-table">
              <thead>
                <tr>
                  {columns.map((key) => (
                    <th key={key} title={key}>
                      {label(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((key) => (
                      <td key={key}>
                        <Value value={row[key] ?? null} depth={depth + 1} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-note">
            Showing {rows.length} of {value.length} items and up to eight fields
            per row. Complete captured data is under Raw command output.
          </p>
        </>
      );
    }
    return (
      <>
        <ol>
          {rows.map((row, i) => (
            <li key={i}>
              <Value value={row} depth={depth + 1} />
            </li>
          ))}
        </ol>
        {value.length > rows.length && (
          <p>Showing the first 100 items. See raw output for the rest.</p>
        )}
      </>
    );
  }
  const entries = Object.entries(value);
  return (
    <>
      <dl className="rig-result-fields">
        {entries.slice(0, 50).map(([key, entry]) => (
          <div key={key}>
            <dt title={key}>{label(key)}</dt>
            <dd>
              <Value value={entry} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
      {entries.length > 50 && (
        <p>Additional fields are available in raw output.</p>
      )}
    </>
  );
}
export default function RigCommandResult({ output }: { output: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true, value: JSON.parse(output) };
    } catch {
      return { ok: false, value: null };
    }
  }, [output]);
  return parsed.ok ? (
    <>
      <Value value={parsed.value} />
      <details>
        <summary title="Inspect the exact captured CLI output">
          Raw command output
        </summary>
        <pre className="rig-output">{output}</pre>
      </details>
    </>
  ) : (
    <pre className="rig-output">{output}</pre>
  );
}
