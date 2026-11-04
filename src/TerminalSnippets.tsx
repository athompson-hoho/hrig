import { useState } from "react";
import { ErrorBox, Modal } from "./components";
import { snippetError, type TerminalSnippet } from "./terminal-commands";
export default function TerminalSnippets({ name, snippets, onChange, onInsert, onClose }: {
  name: string; snippets: TerminalSnippet[]; onChange: (value: TerminalSnippet[]) => void;
  onInsert: (text: string, run: boolean) => void; onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const [error, setError] = useState("");
  function insert(run: boolean) {
    const problem = snippetError(text);
    setError(problem);
    if (problem) return;
    if (run) setReview(text);
    else { onInsert(text, false); onClose(); }
  }
  return <Modal title="Terminal snippets" subtitle={name} onClose={onClose}>
    <p className="field-note">Saved locally in workspace settings. Single-line commands only. Insert adds text at the terminal cursor without pressing Enter; check any existing input first.</p>
    {error && <ErrorBox error={error} />}
    {review !== null ? <>
      <p>Send this exact text followed by Enter to {name}? Existing input at the cursor will also be submitted.</p>
      <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{review}</pre>
      <div className="modal-actions"><button onClick={() => setReview(null)}>Back</button><button className="primary-button" onClick={() => {onInsert(review,true);onClose();}}>Insert and run</button></div>
    </> : <>
      {snippets.map(s => <div className="modal-actions" key={s.id}><button onClick={() => {setLabel(s.name);setText(s.text);}}>{s.name}</button><button aria-label={`Delete snippet ${s.name}`} onClick={() => onChange(snippets.filter(item => item.id !== s.id))}>Delete</button></div>)}
      <label className="field">Name<input value={label} onChange={e => setLabel(e.target.value)} maxLength={80}/></label>
      <label className="field">Command<textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={10000}/></label>
      <div className="modal-actions">
        <button onClick={() => {const problem=snippetError(text);setError(problem || (!label.trim() ? "Name this snippet first." : ""));if (!problem && label.trim()) onChange([...snippets.filter(s => s.name !== label.trim()), {id:crypto.randomUUID(),name:label.trim(),text}]);}}>Save snippet</button>
        <button onClick={() => insert(false)}>Insert</button><button onClick={() => insert(true)}>Review insert and run…</button>
      </div>
    </>}
  </Modal>;
}
