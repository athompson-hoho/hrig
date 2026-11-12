import { useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdown-preview";

// Renders the parsed Markdown tree as React elements. No HTML is ever injected,
// links never navigate (their address is shown), and images are not loaded.
function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.text;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "strong":
        return <strong key={i}>{inline(n.children)}</strong>;
      case "em":
        return <em key={i}>{inline(n.children)}</em>;
      case "image":
        return <span key={i} className="md-image" title={n.href}>[image: {n.alt || "no description"}]</span>;
      case "link":
        return (
          <span key={i} className="md-link" title={n.href}>
            {inline(n.children)}
            <span className="md-link-target"> ({n.href}){n.safe ? "" : " · not a web link"}</span>
          </span>
        );
    }
  });
}

function blocks(list: Block[], base = ""): ReactNode[] {
  return list.map((b, i) => {
    const key = base + i;
    switch (b.t) {
      case "heading": {
        const H = (`h${Math.min(6, Math.max(1, b.level))}`) as "h1";
        return <H key={key}>{inline(b.children)}</H>;
      }
      case "paragraph":
        return <p key={key}>{inline(b.children)}</p>;
      case "code":
        return <pre key={key}><code data-lang={b.lang || undefined}>{b.text}</code></pre>;
      case "quote":
        return <blockquote key={key}>{blocks(b.children, key + ".")}</blockquote>;
      case "hr":
        return <hr key={key} />;
      case "list": {
        const items = b.items.map((item, j) => <li key={j}>{blocks(item, `${key}.${j}.`)}</li>);
        return b.ordered ? <ol key={key} start={b.start}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      case "table":
        return (
          <table key={key}>
            <thead>
              <tr>
                {b.head.map((c, j) => <th key={j} style={b.align[j] ? { textAlign: b.align[j] as any } : undefined}>{inline(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => <td key={j} style={b.align[j] ? { textAlign: b.align[j] as any } : undefined}>{inline(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        );
    }
  });
}

export default function MarkdownPreview({ source }: { source: string }) {
  const model = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="markdown-preview" role="region" aria-label="Markdown preview" tabIndex={0}>
      {model.blocks.length ? blocks(model.blocks) : <p className="subtle">This file is empty.</p>}
      {model.truncated && <p className="subtle" role="status">Preview shows only the beginning of this large file. Switch to Source to see all of it.</p>}
    </div>
  );
}
