import { useState } from "react";
import { ErrorBox, Modal } from "./components";
import { snippetError, type TerminalSnippet } from "./terminal-commands";
import { expand, type SnippetContext } from "./snippet-vars";
import { SnippetExport, SnippetImport } from "./SnippetTransfer";
const PLACEHOLDER_NOTE = "Placeholders {host}, {seat} and {project} are filled in from this terminal when you insert, and the preview shows the exact text. Write {{host}} to keep the braces as they are.";
export default function TerminalSnippets({ name, connection, terminalId, snippets, context, onChange, onInsert, onClose }: {
  name: string; connection: string; terminalId: string; snippets: TerminalSnippet[]; context: SnippetContext; onChange: (value: TerminalSnippet[]) => void;
  onInsert: (text: string, run: boolean) => void; onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "export" | "import">("list");
  function insert(run: boolean) {
    const problem = snippetError(text);
    setError(problem);
    if (problem) return;
    const expanded = expand(text, context);
    if (!expanded.ok) { setError(expanded.error); return; }
    if (run) setReview(expanded.text);
    else { onInsert(expanded.text, false); onClose(); }
  }
  const preview = snippetError(text) ? null : expand(text, context);
  return <Modal title="Terminal snippets" subtitle={`${name} · ${connection} · ${terminalId}`} onClose={onClose}>
    <p className="field-note">Saved locally in workspace settings. Single-line commands only. Insert adds text at the terminal cursor without pressing Enter; check any existing input first.</p>
    {error && <ErrorBox error={error} />}
    {view === "export" ? <SnippetExport snippets={snippets} onBack={() => setView("list")} /> : view === "import" ? <SnippetImport snippets={snippets} onChange={onChange} onBack={() => setView("list")} /> : review !== null ? <>
      <p>Send this exact text followed by Enter to {name} on {connection} (terminal {terminalId})? Existing input at the cursor will also be submitted.</p>
      <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{review}</pre>
      <div className="modal-actions"><button onClick={() => setReview(null)}>Back</button><button className="primary-button" onClick={() => {onInsert(review,true);onClose();}}>Insert and run</button></div>
    </> : <>
      {snippets.map(s => <div className="modal-actions" key={s.id}><button onClick={() => {setLabel(s.name);setText(s.text);}}>{s.name}</button><button aria-label={`Delete snippet ${s.name}`} onClick={() => onChange(snippets.filter(item => item.id !== s.id))}>Delete</button></div>)}
      <label className="field">Name<input value={label} onChange={e => setLabel(e.target.value)} maxLength={80}/></label>
      <label className="field">Command<textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={10000}/></label>
      <p className="field-note">{PLACEHOLDER_NOTE}</p>
      {preview && !preview.ok && <div className="field-note" role="status">Cannot insert here: {preview.error}</div>}
      {preview && preview.ok && preview.changed && <div className="field-note" role="status">
        Insert will add exactly this text, without pressing Enter:
        <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{preview.text}</pre>
        {preview.careful.length > 0 && <p>The value of {preview.careful.map(token => `{${token}}`).join(", ")} has spaces or shell characters. Check the quoting in the preview before you insert.</p>}
      </div>}
      <div className="modal-actions">
        <button onClick={() => {const problem=snippetError(text);setError(problem || (!label.trim() ? "Name this snippet first." : ""));if (!problem && label.trim()) onChange([...snippets.filter(s => s.name !== label.trim()), {id:crypto.randomUUID(),name:label.trim(),text}]);}}>Save snippet</button>
        <button onClick={() => insert(false)}>Insert</button><button onClick={() => insert(true)}>Review insert and run…</button>
      </div>
      <div className="modal-actions"><button onClick={() => {setError("");setView("export");}}>Export snippets</button><button onClick={() => {setError("");setView("import");}}>Import snippets</button></div>
    </>}
  </Modal>;
}
