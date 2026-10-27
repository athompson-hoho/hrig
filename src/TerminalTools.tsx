import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { ArrowDown, ArrowUp, Copy, Download, Search, X } from "lucide-react";
import { IconButton } from "./components";
import { terminalText } from "./terminal-output";

export default function TerminalTools({
  terminal,
  generation,
}: {
  terminal: RefObject<Terminal | null>;
  generation: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState({ resultIndex: -1, resultCount: 0 });
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState("");
  const search = useRef<SearchAddon | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const viewport = useRef<number | null>(null);
  const show = () => {
    viewport.current ??= terminal.current?.buffer.active.viewportY ?? 0;
    setOpen(true);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.select();
    });
  };
  const close = () => {
    setOpen(false);
    search.current?.clearDecorations();
    if (viewport.current !== null)
      terminal.current?.scrollToLine(viewport.current);
    viewport.current = null;
    terminal.current?.focus();
  };
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const addon = new SearchAddon({ highlightLimit: 1000 });
    search.current = addon;
    term.loadAddon(addon);
    const listener = addon.onDidChangeResults(setResult);
    term.attachCustomKeyEventHandler((event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        if (event.type === "keydown") {
          event.preventDefault();
          show();
        }
        return false;
      }
      return true;
    });
    return () => {
      listener.dispose();
      addon.dispose();
      search.current = null;
    };
  }, [generation]);
  const find = (backwards = false, incremental = false) => {
    setInvalid("");
    if (!query) {
      search.current?.clearDecorations();
      setResult({ resultIndex: -1, resultCount: 0 });
      return;
    }
    if (regex) {
      try {
        new RegExp(query);
      } catch {
        setInvalid("Invalid regular expression");
        search.current?.clearDecorations();
        return;
      }
    }
    const options = {
      regex,
      caseSensitive,
      incremental,
      decorations: {
        matchBackground: "#445567",
        activeMatchBackground: "#38664f",
        matchOverviewRuler: "#91b4ec",
        activeMatchColorOverviewRuler: "#98e2c2",
      },
    };
    search.current?.[backwards ? "findPrevious" : "findNext"](query, options);
  };
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      // Invalidate cached highlights when options change as well as the query.
      search.current?.clearDecorations();
      find(false, true);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, regex, caseSensitive, open, generation]);
  const output = async (action: "selection" | "all" | "export") => {
    try {
      const term = terminal.current;
      if (!term) return;
      const text =
        action === "selection" ? term.getSelection() : terminalText(term);
      if (!text) {
        setNotice(
          action === "selection"
            ? "Select terminal text first."
            : "No output to copy.",
        );
        return;
      }
      if (action === "export") {
        const saved = await window.hrig.exportTerminal(text);
        setNotice(saved.saved ? "Output exported." : "Export canceled.");
      } else {
        await navigator.clipboard.writeText(text);
        setNotice(
          action === "selection" ? "Selection copied." : "Output copied.",
        );
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  return (
    <div
      className="terminal-tools"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <div
        className="terminal-tools-actions"
        role="toolbar"
        aria-label="Terminal output tools"
      >
        <IconButton
          title="Find in terminal (Ctrl/Cmd+F)"
          active={open}
          onClick={show}
        >
          <Search size={13} />
        </IconButton>
        <IconButton
          title="Copy terminal selection"
          onClick={() => void output("selection")}
        >
          <Copy size={13} />
        </IconButton>
        <button onClick={() => void output("all")}>Copy output</button>
        <IconButton
          title="Export terminal output"
          onClick={() => void output("export")}
        >
          <Download size={13} />
        </IconButton>
        <span>Retained output only</span>
      </div>
      <div className="terminal-tool-overlays">
        {open && (
          <div
            className="terminal-find"
            role="search"
            aria-label="Terminal search"
          >
            <input
              ref={field}
              aria-label="Find in terminal"
              placeholder="Find in terminal"
              value={query}
              maxLength={500}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  find(e.shiftKey);
                }
              }}
            />
            <button
              aria-label="Match case"
              aria-pressed={caseSensitive}
              onClick={() => setCase(!caseSensitive)}
            >
              Aa
            </button>
            <button
              aria-label="Use regular expression"
              aria-pressed={regex}
              onClick={() => setRegex(!regex)}
            >
              .*
            </button>
            <span role="status">
              {invalid ||
                (!query
                  ? "Type to search"
                  : result.resultCount >= 1000
                    ? "1,000+ matches"
                    : `${result.resultIndex + 1} of ${result.resultCount}`)}
            </span>
            <IconButton
              title="Previous terminal match"
              onClick={() => find(true)}
            >
              <ArrowUp size={13} />
            </IconButton>
            <IconButton title="Next terminal match" onClick={() => find()}>
              <ArrowDown size={13} />
            </IconButton>
            <IconButton title="Close terminal search" onClick={close}>
              <X size={13} />
            </IconButton>
          </div>
        )}
        {notice && (
          <div className="terminal-tool-notice" role="status">
            {notice}
            <IconButton
              title="Dismiss terminal notice"
              onClick={() => setNotice("")}
            >
              <X size={12} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
