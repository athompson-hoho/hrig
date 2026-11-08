import { useState } from "react";
import { ErrorBox } from "./components";
import type { TerminalSnippet } from "./terminal-commands";
import {
  MAX_IMPORT_CHARS,
  MAX_IMPORT_SNIPPETS,
  describeExport,
  mergeSnippets,
  parseSnippets,
} from "./snippet-io";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The export view: the saved snippets as selectable JSON text, name and text only, for the person to copy. */
export function SnippetExport({
  snippets,
  onBack,
}: {
  snippets: TerminalSnippet[];
  onBack: () => void;
}) {
  const out = describeExport(snippets);
  return (
    <>
      <p className="field-note">
        Export lists each saved snippet's name and text as plain JSON, exactly
        as saved, and nothing else: no ids, host names or paths. Snippet text
        can hold anything you typed, so do not keep passwords, tokens or other
        secrets in snippets. HRig does not write this anywhere or send it
        anywhere; select it and copy it yourself.
      </p>
      {out.count === 0 ? (
        <p className="field-note">There are no saved snippets to export.</p>
      ) : (
        <>
          <p className="field-note">
            {plural(out.count, "snippet")} in this export.
          </p>
          {!out.fits && (
            <p className="field-note">
              HRig imports at most {MAX_IMPORT_SNIPPETS} snippets and 256 KB
              from one text, so this export is too large to import in one go.
            </p>
          )}
          <label className="field">
            Snippets as JSON
            <textarea
              readOnly
              rows={10}
              value={out.json}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        </>
      )}
      <div className="modal-actions">
        <button onClick={onBack}>Back</button>
      </div>
    </>
  );
}

/** The import view: pasted export text is checked and counted first, and only the Import button adds anything. */
export function SnippetImport({
  snippets,
  onChange,
  onBack,
}: {
  snippets: TerminalSnippet[];
  onChange: (value: TerminalSnippet[]) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [done, setDone] = useState("");
  const parsed = checked === null ? null : parseSnippets(checked);
  let previewId = 0;
  const plan =
    parsed && !parsed.error
      ? mergeSnippets(snippets, parsed.snippets, () => `preview-${previewId++}`)
      : null;
  const importNow = () => {
    if (!parsed || parsed.error) return;
    const merged = mergeSnippets(snippets, parsed.snippets, () =>
      crypto.randomUUID(),
    );
    if (merged.added === 0) return;
    onChange(merged.snippets);
    setDone(
      `Imported ${plural(merged.added, "snippet")}. Nothing was sent to a terminal.`,
    );
    setText("");
    setChecked(null);
  };
  return (
    <>
      <p className="field-note">
        Paste text that HRig exported. Nothing is added until you check it and
        choose Import: snippets you already have are never changed or replaced,
        and nothing is sent to a terminal.
      </p>
      {done && (
        <div className="field-note" role="status">
          {done}
        </div>
      )}
      <label className="field">
        Exported snippets
        <textarea
          rows={8}
          value={text}
          maxLength={MAX_IMPORT_CHARS + 1}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
            setDone("");
          }}
        />
      </label>
      {parsed && parsed.error && <ErrorBox error={parsed.error} />}
      {parsed && plan && (
        <div className="field-note" role="status">
          <p>
            {plural(plan.added, "snippet")} can be imported
            {plan.renamed > 0
              ? `, ${plan.renamed} of them under a numbered name because that name is already used`
              : ""}
            . {plan.duplicates + parsed.duplicates} already saved or repeated
            and skipped. {parsed.rejected.length + plan.invalid} rejected.
          </p>
          {parsed.rejected.slice(0, 5).map((item) => (
            <p key={item.index}>
              Item {item.index}: {item.reason}
            </p>
          ))}
          {parsed.rejected.length > 5 && (
            <p>And {parsed.rejected.length - 5} more rejected.</p>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button onClick={() => setChecked(text)}>Check import</button>
        <button disabled={!plan || plan.added === 0} onClick={importNow}>
          {plan && plan.added > 0
            ? `Import ${plural(plan.added, "snippet")}`
            : "Import"}
        </button>
        <button onClick={onBack}>Back</button>
      </div>
    </>
  );
}
