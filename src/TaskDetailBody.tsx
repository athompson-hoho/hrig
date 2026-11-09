import { useMemo, useState, type ReactNode } from "react";
import {
  MAX_MARKDOWN_BLOCKS,
  MAX_MARKDOWN_CHARS,
  parseMarkdown,
  pickTaskBody,
  type MdBlock,
  type MdInline,
} from "./markdown-safe";

// Markdown headings 1 to 3 sit below the dialog's own title.
const HEADINGS = ["h3", "h4", "h5"] as const;

function renderInline(nodes: MdInline[]): ReactNode[] {
  return nodes.map((node) => node.text);
}

function renderBlock(block: MdBlock, key: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = HEADINGS[block.level - 1];
      return <Tag key={key}>{renderInline(block.children)}</Tag>;
    }
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    default:
      return <p key={key}>{renderInline(block.children)}</p>;
  }
}

/** The body of a task in the detail dialog: the text as safe markdown, with a switch to the raw JSON passed in as children. A task with no text shows the children alone. Every string reaches the page as React text, never as markup, and nothing here can send anything. */
export default function TaskDetailBody({
  detail,
  children,
}: {
  detail: unknown;
  children: ReactNode;
}) {
  const [raw, setRaw] = useState(false);
  const picked = useMemo(() => pickTaskBody(detail), [detail]);
  const parsed = useMemo(
    () => (picked ? parseMarkdown(picked.text) : null),
    [picked],
  );
  if (!picked || !parsed) return <>{children}</>;
  return (
    <>
      <div className="segmented" role="group" aria-label="Task body view">
        <button
          className={raw ? "" : "selected"}
          aria-pressed={!raw}
          onClick={() => setRaw(false)}
        >
          Rendered
        </button>
        <button
          className={raw ? "selected" : ""}
          aria-pressed={raw}
          onClick={() => setRaw(true)}
        >
          Raw JSON
        </button>
      </div>
      {raw ? (
        children
      ) : (
        <>
          {picked.field !== "body" && (
            <p className="field-note">
              This task has no body; showing its {picked.field} field.
            </p>
          )}
          <div
            className="task-markdown"
            role="region"
            aria-label="Task body"
            tabIndex={0}
          >
            {parsed.blocks.map(renderBlock)}
          </div>
          {parsed.truncated && (
            <p className="field-note">
              Showing the start of a longer text (at most{" "}
              {MAX_MARKDOWN_CHARS.toLocaleString("en-US")} characters and{" "}
              {MAX_MARKDOWN_BLOCKS.toLocaleString("en-US")} blocks). Raw JSON
              has all of it.
            </p>
          )}
        </>
      )}
    </>
  );
}
