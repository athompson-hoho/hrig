import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { ArrowDown, ArrowUp, Copy, Download, Search, X } from "lucide-react";
import { IconButton } from "./components";
import { terminalText } from "./terminal-output";
import { pasteClipboard, pastePreview, endsWithLineBreak } from "./terminal-paste";
import TerminalPasteConfirm from "./TerminalPasteConfirm";
import { classifyTerminalKey } from "./terminal-keys";
import { useSettings } from "./SettingsContext";
import { createCopyOnSelect, COPY_SELECT_DELAY_MS } from "./terminal-copy-select";
import { copyTextForClipboard } from "./terminal-copy-text";
import { draftFromSelection, publishSnippetDraft } from "./snippet-draft";
import { requestTaskDraft } from "./task-draft";
import type { TerminalLink, TerminalLinks } from "./terminal-link-at";
import {
  historyKeyDirection,
  pushSearchQuery,
  recallSearchQuery,
} from "./terminal-search-history";

// Recent find queries, shared by every open terminal and kept in memory only: a query can hold a secret, so the list is never saved, restored or exported.
let searchHistory: readonly string[] = [];

// Height of the two link items and their separator in the right-click menu (two 33px buttons and an 11px separator, see .dropdown in styles.css); added to the bottom-edge clamp only while they show.
const LINK_ITEMS_HEIGHT = 77;

export default function TerminalTools({
  terminal,
  generation,
  findRequest = 0,
  taskRequest = 0,
  terminalId,
  links,
}: {
  terminal: RefObject<Terminal | null>;
  generation: number;
  findRequest?: number;
  taskRequest?: number;
  terminalId: string;
  links?: RefObject<TerminalLinks>;
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
  // Which remembered query this find box shows while ArrowUp and ArrowDown browse (-1 when it is not browsing); one per box, so two terminals never share a place in the list.
  const historyAt = useRef(-1);
  const [menu, setMenu] = useState<{ x: number; y: number; selection: boolean; link: TerminalLink | null } | null>(null);
  // Ref so toggling the setting is read at settle time and never re-subscribes the effect below.
  const { effective } = useSettings();
  const copyOnSelect = useRef(effective["terminal.copyOnSelect"]);
  copyOnSelect.current = effective["terminal.copyOnSelect"];
  // Find selects each match; copying those would overwrite the clipboard while searching.
  const findOpen = useRef(false);
  findOpen.current = open;
  // paste() runs from the key handler registered in the [generation] effect, so it closes over an old render; only a ref is current at paste time.
  const confirmMultiline = useRef(effective["terminal.confirmMultilinePaste"]);
  confirmMultiline.current = effective["terminal.confirmMultilinePaste"];
  // Copy runs from handlers registered in the [generation] effect that close over an old render, so only a ref is current at copy time.
  const trimCopy = useRef(effective["terminal.copyTrimTrailingWhitespace"]);
  trimCopy.current = effective["terminal.copyTrimTrailingWhitespace"];
  // Every write of terminal text to the clipboard goes through this function; paste and export never do.
  const clipboardText = (text: string) => copyTextForClipboard(text, trimCopy.current);
  // The one read of the selection for copy and for Save selection as snippet; the snippet route never writes to the clipboard, so it does not use clipboardText.
  const selectedText = () => terminal.current?.getSelection();
  // The one clipboard write for text the person picked (the selection or a link); a failure uses the same notice.
  const copyText = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(clipboardText(text));
      setNotice(done);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  const copySelection = async () => {
    const text = selectedText();
    if (!text) return;
    await copyText(text, "Selection copied.");
  };
  // Opens Saved snippets filled in from the selection; nothing is saved or typed until the person presses Save snippet there, and a selection that cannot be one line is explained here instead.
  const saveSelectionAsSnippet = () => {
    const draft = draftFromSelection(selectedText());
    if (draft.ok) publishSnippetDraft(terminalId, draft.text);
    else setNotice(draft.error);
  };
  // Opens the Assign work dialog filled in from the selection; nothing is created or sent until the person presses Create assigned task there, and a selection that cannot become a task is explained here instead.
  const createTaskFromSelection = () => setNotice(requestTaskDraft(terminalId, selectedText()));
  useEffect(() => { if (taskRequest) createTaskFromSelection(); }, [taskRequest]);
  // term.paste honors bracketed-paste mode and normalizes newlines; the text
  // reaches the shell only through the terminal's normal input path.
  const [hasImage,setHasImage]=useState(false);
  const pasteImage=async()=>{try{const text=await window.hrig.pasteClipboardImage(terminalId);if(text)terminal.current?.paste(text);}catch(e){setNotice((e as Error).message);}terminal.current?.focus();};
  // Component state holds only the count, the truncated preview and a boolean; the clipboard text stays in pasteClipboard's local variable.
  const [pasteAsk, setPasteAsk] = useState<{
    lines: number;
    preview: string;
    endsWithBreak: boolean;
    answer: (ok: boolean) => void;
  } | null>(null);
  const pendingAnswer = useRef<((ok: boolean) => void) | null>(null);
  const askPaste = (text: string, lines: number) => {
    // Never leave two questions open: a newer paste cancels the older one.
    pendingAnswer.current?.(false);
    return new Promise<boolean>((resolve) => {
      const answer = (ok: boolean) => {
        if (pendingAnswer.current !== answer) return;
        pendingAnswer.current = null;
        setPasteAsk(null);
        resolve(ok);
      };
      pendingAnswer.current = answer;
      setPasteAsk({ lines, preview: pastePreview(text), endsWithBreak: endsWithLineBreak(text), answer });
    });
  };
  // An unmounted dialog must not leave a paste pending.
  useEffect(() => () => pendingAnswer.current?.(false), []);
  const paste = async () => {
    // Bind the paste to the terminal that asked: a reconnect swaps terminal.current while the dialog is open.
    const target = terminal.current;
    try {
      await pasteClipboard({readText:()=>window.hrig.readClipboardText(),hasImage:()=>window.hrig.clipboardHasImage(),pasteText:text=>{ if (terminal.current === target) target?.paste(text); },pasteImage,confirm:askPaste,confirmEnabled:confirmMultiline.current});
    } catch (e) {
      setNotice((e as Error).message);
    }
    terminal.current?.focus();
  };
  const show = () => {
    viewport.current ??= terminal.current?.buffer.active.viewportY ?? 0;
    setOpen(true);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.select();
    });
  };
  useEffect(() => { if (findRequest) show(); }, [findRequest]);
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
      const action = classifyTerminalKey(
        event,
        window.hrig.platform,
        term.hasSelection(),
      );
      if (action === "pass") return true;
      // Handle on keydown only; swallow the matching keypress/keyup so xterm
      // never also sends the control character (e.g. ^V) to the shell.
      if (event.type === "keydown") {
        event.preventDefault();
        if (action === "find") show();
        else if (action === "paste") void paste();
        else if (action === "clear") {
          term.clear();
          term.focus();
        } else void copySelection();
      }
      return false;
    });
    // Clipboard write only; success is silent, failure uses the existing notice.
    const copyOnSelectScheduler = createCopyOnSelect({
      delayMs: COPY_SELECT_DELAY_MS,
      enabled: () => copyOnSelect.current && !findOpen.current,
      read: () => term.getSelection(),
      copy: (text) => navigator.clipboard.writeText(clipboardText(text)),
      onError: (e) => setNotice((e as Error).message),
    });
    const selectionListener = term.onSelectionChange(() => copyOnSelectScheduler.notify());
    const host = term.element?.parentElement;
    const contextmenu = (event: MouseEvent) => {
      event.preventDefault();
      setHasImage(false);
      void window.hrig.clipboardHasImage().then(setHasImage).catch(e=>setNotice(e.message));
      // The link xterm underlines under the pointer right now, if any; read here because the menu is not under the pointer once it shows.
      setMenu({ x: event.clientX, y: event.clientY, selection: term.hasSelection(), link: links?.current.hovered ?? null });
    };
    host?.addEventListener("contextmenu", contextmenu);
    // xterm answers a native copy event, for example from the macOS Edit menu, with the raw selection; this listener runs after its handler and replaces that text.
    const nativeCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData || !term.hasSelection()) return;
      event.clipboardData.setData("text/plain", clipboardText(term.getSelection()));
      event.preventDefault();
    };
    host?.addEventListener("copy", nativeCopy);
    return () => {
      host?.removeEventListener("contextmenu", contextmenu);
      host?.removeEventListener("copy", nativeCopy);
      selectionListener.dispose();
      copyOnSelectScheduler.cancel();
      listener.dispose();
      addon.dispose();
      search.current = null;
      // A confirmation asked of the old terminal must never paste into its replacement.
      pendingAnswer.current?.(false);
    };
  }, [generation]);
  const find = (backwards = false, incremental = false) => {
    setInvalid("");
    if (!query) {
      search.current?.clearDecorations();
      setResult({ resultIndex: -1, resultCount: 0 });
      return false;
    }
    if (regex) {
      try {
        new RegExp(query);
      } catch {
        setInvalid("Invalid regular expression");
        search.current?.clearDecorations();
        return false;
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
    return search.current !== null;
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
        await navigator.clipboard.writeText(clipboardText(text));
        setNotice(
          action === "selection" ? "Selection copied." : "Output copied.",
        );
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  const choose = (action: () => void | Promise<void>) => () => {
    setMenu(null);
    void action();
    terminal.current?.focus();
  };
  const menuLink = menu?.link ?? null;
  return (
    <>
      {menu && (
        <div
          className="dropdown terminal-context-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 180),
            top: Math.min(menu.y, window.innerHeight - 223 - (menuLink ? LINK_ITEMS_HEIGHT : 0)),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menuLink && (
            <>
              <button role="menuitem" onClick={choose(() => links?.current.open?.(menuLink))}>
                <span>Open link</span>
              </button>
              <button role="menuitem" onClick={choose(() => copyText(menuLink.text, "Link copied."))}>
                <span>Copy link</span>
              </button>
              <div className="menu-separator" />
            </>
          )}
          <button role="menuitem" disabled={!menu.selection} onClick={choose(copySelection)}>
            <span>Copy</span>
          </button>
          <button role="menuitem" disabled={!menu.selection} onClick={choose(saveSelectionAsSnippet)}>
            <span>Save selection as snippet…</span>
          </button>
          <button role="menuitem" disabled={!menu.selection} onClick={choose(createTaskFromSelection)}>
            <span>Create task from selection…</span>
          </button>
          <button role="menuitem" onClick={choose(paste)}>
            <span>Paste</span>
          </button>
          {hasImage&&<button role="menuitem" onClick={choose(pasteImage)}><span>Paste image…</span></button>}
          <div className="menu-separator" />
          <button role="menuitem" onClick={choose(() => terminal.current?.selectAll())}>
            <span>Select all</span>
          </button>
        </div>
      )}
      {pasteAsk && (
        <TerminalPasteConfirm
          lines={pasteAsk.lines}
          preview={pasteAsk.preview}
          endsWithBreak={pasteAsk.endsWithBreak}
          onAnswer={pasteAsk.answer}
        />
      )}
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
                  if (find(e.shiftKey)) {
                    searchHistory = pushSearchQuery(searchHistory, query);
                    historyAt.current = -1;
                  }
                }
                const direction = historyKeyDirection(
                  e,
                  e.nativeEvent.isComposing,
                );
                if (!direction) return;
                const step = recallSearchQuery(
                  searchHistory,
                  historyAt.current,
                  direction,
                  query,
                );
                if (!step) return;
                e.preventDefault();
                historyAt.current = step.index;
                setQuery(step.text);
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
    </>
  );
}
