import { useEffect, useState, useRef } from "react";
import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import { Save, FileCode2, Eye, Code2 } from "lucide-react";
import MarkdownPreview from "./MarkdownPreview";
import { isMarkdownPath } from "./markdown-preview";
import FilePreview, { type FileInspection } from "./FilePreview";
import { largeFileNotice, PREVIEWABLE_READ_ERROR } from "./large-file";
import { ErrorBox, Loading, Modal } from "./components";
import type { PanelConfig } from "./types";
import {
  buffers,
  problems,
  bufferConfigs,
  persistBuffer,
  editorFocusers,
} from "./editor-buffers";
import { draftKey, draftOperation, readDraft } from "./drafts";
import { useSettings } from "./SettingsContext";
import { editorTheme, themeId } from "./themes";
import { editorModelPath } from "./editor-uri";
import {
  editorChangeOwner,
  canPublishEditorChange,
  canAcknowledgeEditorChange,
} from "./editor-external-change";
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === "json") return new JsonWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });
monaco.editor.defineTheme("hrig", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "697386" },
    { token: "string", foreground: "a1d6b8" },
    { token: "keyword", foreground: "b8abed" },
  ],
  colors: {
    "editor.background": "#14161b",
    "editor.foreground": "#d0d5e0",
    "editorLineNumber.foreground": "#4f5769",
    "editor.selectionBackground": "#30463f",
    "editor.lineHighlightBackground": "#1b1e26",
    "editorCursor.foreground": "#98e2c2",
    "editorWidget.background": "#20232b",
    "editor.inactiveSelectionBackground": "#29323c",
  },
});
function language(path = "") {
  const ext = path.split(".").pop();
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        json: "json",
        md: "markdown",
        py: "python",
        css: "css",
        html: "html",
        yml: "yaml",
        yaml: "yaml",
        sh: "shell",
        ps1: "powershell",
        rs: "rust",
        toml: "ini",
        cjs: "javascript",
      } as Record<string, string>
    )[ext || ""] || "plaintext"
  );
}

// Hide every local value as soon as its owner changes, before effect cleanup.
// Setters retained by an obsolete widget/request cannot revive that value.
function useEditorState<T>(generation: { active: boolean }, initial: T | (() => T)) {
  const fallback = useRef<{ generation: object; value: T } | null>(null);
  if (fallback.current?.generation !== generation) {
    fallback.current = { generation, value: typeof initial === "function"
      ? (initial as () => T)() : initial };
  }
  const initialValue = fallback.current.value;
  const [state, setState] = useState(() => ({ generation, value: initialValue }));
  const value = state.generation === generation ? state.value : initialValue;
  const update = (action: T | ((previous: T) => T)) => {
    if (!generation.active) return;
    setState(previous => {
      if (!generation.active) return previous;
      return { generation, value: typeof action === "function"
        ? (action as (previous: T) => T)(previous.generation === generation ? previous.value : initialValue)
        : action };
    });
  };
  return [value, update] as const;
}

const DISK_CHECK_FAILURE_NOTICE = "Could not check disk changes. Your edits are preserved. HRig will check again on focus or at the next disk check.";

function diskRead(result: { content?: unknown; revision?: unknown; truncated?: unknown }) {
  if (!result || Array.isArray(result) ||
    typeof result.content !== "string" || typeof result.revision !== "string" ||
    (result.truncated !== undefined && result.truncated !== false) ||
    Object.keys(result).some(key => !["content", "revision", "truncated"].includes(key)))
    throw new Error("Could not read a complete disk version.");
  return { content: result.content, revision: result.revision };
}
export default function EditorPanel({
  id,
  config,
  diff = false,
  onDirty,
  onSaved,
  onReady,
}: {
  id: string;
  config: PanelConfig;
  diff?: boolean;
  onDirty: (id: string, dirty: boolean) => void;
  onSaved: () => void;
  onReady?: (id: string) => boolean;
}) {
  const { effective: preferences, project: projectPreferences, update: updateSetting } = useSettings();
  const colorTheme = themeId(preferences);
  useEffect(() => {
    monaco.editor.defineTheme(
      "hrig-settings",
      editorTheme(preferences, colorTheme),
    );
    monaco.editor.setTheme("hrig-settings");
  }, [colorTheme, preferences["appearance.accent"]]);
  const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
    fontSize: preferences["editor.fontSize"],
    fontFamily: preferences["editor.fontFamily"],
    tabSize: preferences["editor.tabSize"],
    insertSpaces: preferences["editor.insertSpaces"],
    detectIndentation: false,
    wordWrap: preferences["editor.wordWrap"] as "on" | "off",
    minimap: { enabled: preferences["editor.minimap"] },
    lineNumbers: preferences["editor.lineNumbers"] as "on" | "relative" | "off",
    fontLigatures: preferences["editor.fontLigatures"],
    renderWhitespace: preferences["editor.renderWhitespace"] as
      "selection" | "all" | "none",
    bracketPairColorization: { enabled: preferences["editor.bracketPairs"] },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: !preferences["appearance.reduceMotion"],
  };
  const owner = editorChangeOwner(id, config, diff);
  const lifetime = useRef({ owner, active: true, edit: 0, request: 0, busy: false,
    buffer: buffers.get(id) });
  if (lifetime.current.owner !== owner) {
    lifetime.current.active = false;
    lifetime.current = { owner, active: true, edit: 0, request: 0, busy: false,
      buffer: buffers.get(id) };
  }
  const generation = lifetime.current;
  const [value, setValue] = useEditorState<string | undefined>(generation, () => {
    const registered = bufferConfigs.get(id);
    return !diff && registered && editorChangeOwner(id, registered) === owner
      ? generation.buffer?.content : undefined;
  });
  const [original, setOriginal] = useEditorState(generation, "");
  const [error, setError] = useEditorState(generation, "");
  const [saving, setSaving] = useEditorState(generation, false);
  const [dirty, setDirty] = useEditorState(generation, false);
  const [mdPreview, setMdPreview] = useState(false);
  const [inspected, setInspected] = useState<FileInspection | null>(null);
  const [externalState, setExternalState] = useEditorState<{
    content: string;
    revision: string;
    lifetime: object;
    buffer: object | undefined;
  } | null>(generation, null);
  const [compare, setCompare] = useEditorState(generation, false);
  const [reloadConfirm, setReloadConfirm] = useEditorState(generation, false);
  const [notice, setNotice] = useEditorState(generation, "");
  const [acknowledged, setAcknowledged] = useEditorState<string | null>(generation, null);
  const [reloading, setReloading] = useEditorState(generation, false);
  const ownsBuffer = () => {
    const registered = bufferConfigs.get(id);
    return generation.active && lifetime.current === generation &&
      buffers.get(id) === generation.buffer &&
      editorChangeOwner(id, config, diff) === owner &&
      !!registered && editorChangeOwner(id, registered, diff) === owner;
  };
  const capture = () => {
    const buffer = buffers.get(id);
    return { owner, lifetime: generation, buffer, request: generation.request,
      edit: generation.edit, content: buffer?.content, saved: buffer?.saved, revision: buffer?.revision };
  };
  const current = (captured: ReturnType<typeof capture>, preserveEdits = true) =>
    ownsBuffer() && canPublishEditorChange(captured, capture(), preserveEdits);
  const external = externalState?.lifetime === generation &&
    externalState.buffer === buffers.get(id) && ownsBuffer() ? externalState : null;
  const represented = useRef(external);
  represented.current = external;
  const setExternal = (disk: { content: string; revision: string } | null) =>
    setExternalState(disk && { ...disk, lifetime: generation, buffer: buffers.get(id) });
  const recoveryKey = draftKey(
    "editor",
    config.connection,
    config.root,
    config.path,
  );
  const [recovery, setRecovery] = useEditorState<{
    content: string;
    saved: string;
    revision: string;
  } | null>(generation, () => {
    if (diff || buffers.has(id)) return null;
    try {
      return readDraft(recoveryKey)?.data || null;
    } catch (e) {
      return null;
    }
  });
  const representedRecovery = useRef(recovery);
  representedRecovery.current = recovery;
  const rendered = capture();
  const currentRecovery = () => !!recovery && representedRecovery.current === recovery && current(rendered);
  const persist = () => {
    if (!ownsBuffer()) return;
    try {
      persistBuffer(id);
    } catch (e) {
      setError("Recovery copy: " + (e as Error).message);
    }
  };
  useEffect(() => {
    const cleared = () => {
      if (!ownsBuffer()) return;
      try {
        if (!readDraft(recoveryKey)) setRecovery(null);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    window.addEventListener("hrig:drafts-cleared", cleared);
    return () => window.removeEventListener("hrig:drafts-cleared", cleared);
  }, [generation, recoveryKey]);
  const saveRef = useRef<() => void>(() => {});
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const focusRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (config.line) {
      editorRef.current?.revealLineInCenter(config.line);
      editorRef.current?.setPosition({ lineNumber: config.line, column: 1 });
    }
  }, [config.line]);
  const save = async () => {
    const buffer = buffers.get(id);
    if (!buffer || !ownsBuffer() || generation.busy) return;
    generation.busy = true;
    generation.request++;
    const captured = capture();
    setSaving(true);
    setError("");
    const content = buffer.content;
    try {
      const result = await window.hrig.edit(config.connection, {
        op: "save",
        root: config.root,
        path: config.path,
        content,
        revision: buffer.revision,
      });
      if (!current(captured, false)) return;
      buffer.saved = content;
      buffer.revision = result.revision;
      setAcknowledged(null);
      setExternal(null);
      setCompare(false);
      persist();
      const changed = buffer.content !== content;
      setDirty(changed);
      onDirty(id, changed);
      onSaved();
    } catch (e) {
      if (current(captured, false)) {
        const message = (e as Error).message;
        setError(message.includes("CONFLICT:")
          ? message + "\nFile changed on disk. Your edits are preserved. Compare with disk or reload before trying to save again."
          : message);
      }
    } finally {
      if (ownsBuffer() && buffers.get(id) === buffer && generation.request === captured.request) {
        generation.busy = false;
        setSaving(false);
      }
    }
  };
  saveRef.current = save;
  useEffect(() => {
    generation.active = true;
    const registered = bufferConfigs.get(id);
    if (!diff && ((registered && editorChangeOwner(id, registered) !== owner) ||
      (buffers.has(id) && !registered))) {
      setValue(undefined);
      setError("This panel belongs to a different file buffer. Reopen the original file to recover your edits.");
      return () => { generation.active = false; };
    }
    if (!diff) bufferConfigs.set(id, config);
    setInspected(null);
    let active = true;
    const opening = capture();
    const read = window.hrig.edit(config.connection, {
      op: "read",
      root: config.root,
      path: config.path,
      ...(diff ? { allowMissing: true } : {}),
    });
    (diff
      ? Promise.all([
          read,
          window.hrig.file(config.connection, {
            op: "original",
            root: config.root,
            path: config.path,
          }),
        ])
      : Promise.all([read])
    )
      .then(([result, base]) => {
        if (!active || !generation.active || lifetime.current !== generation ||
          editorChangeOwner(id, config, diff) !== owner ||
          (!diff && !ownsBuffer()) ||
          !canPublishEditorChange(opening, capture())) return;
        // Only an explicit diff opening accepts the closed missing-file marker.
        // It supplies comparison text only, never an editable buffer or revision.
        const missing = diff && result && !Array.isArray(result) && result.missing === true &&
          Object.keys(result).length === 1;
        const disk = missing ? { content: "" } : diskRead(result);
        if (diff) {
          if (!base || Array.isArray(base) || typeof base.content !== "string" ||
            (base.truncated !== undefined && base.truncated !== false) ||
            Object.keys(base).some(key => !["content", "truncated"].includes(key)))
            throw new Error("Could not read the original file version.");
          setOriginal(base.content);
        } else if (!buffers.has(id)) {
          buffers.set(id, {
            content: disk.content,
            saved: disk.content,
            revision: diskRead(result).revision,
          });
          generation.buffer = buffers.get(id);
        }
        setValue(diff ? disk.content : buffers.get(id)?.content);
        if (!diff) {
          const warning = largeFileNotice(new TextEncoder().encode(disk.content).length, preferences["editor.largeFileWarnKb"]);
          if (warning) setNotice(warning);
        }
        const b = buffers.get(id);
        const isDirty = !!b && b.content !== b.saved;
        setDirty(isDirty);
        if (!diff) onDirty(id, isDirty);
      })
      .catch((e) => {
        if (active && generation.active && lifetime.current === generation &&
          editorChangeOwner(id, config, diff) === owner &&
          (diff || ownsBuffer()) &&
          canPublishEditorChange(opening, capture())) {
          // A binary or over-2 MB file cannot be edited; offer a read-only preview
          // (never a buffer, revision or save path) instead of only an error.
          if (!diff && PREVIEWABLE_READ_ERROR.test(String(e?.message))) {
            window.hrig.edit(config.connection, { op: "inspect", root: config.root, path: config.path })
              .then((info) => {
                if (active && generation.active && lifetime.current === generation) {
                  if (info && (info.kind === "image" || info.kind === "binary" || info.kind === "large-text")) setInspected(info);
                  else setError(e.message);
                }
              })
              .catch(() => { if (active && generation.active && lifetime.current === generation) setError(e.message); });
          } else setError(e.message);
        }
      });
    return () => {
      active = false;
      generation.active = false;
      if (editorFocusers.get(id) === focusRef.current)
        editorFocusers.delete(id);
      // Detach first: the React Monaco wrapper disposes models before its widget.
      // Newer Monaco diff widgets require the model to be reset before disposal.
      diffRef.current?.setModel(null);
      diffRef.current = null;
    };
  }, [generation]);
  useEffect(() => {
    const sync = () => {
      if (!ownsBuffer()) {
        // A registry replacement is a refusal, never an invitation to adopt it.
        if (generation.active && lifetime.current === generation &&
          buffers.get(id) !== generation.buffer)
          setError("This panel belongs to a different file buffer. Reopen the original file to recover your edits.");
        return;
      }
      const b = buffers.get(id);
      if (b) {
        setValue(b.content);
        const d = b.content !== b.saved;
        setDirty(d);
        onDirty(id, d);
      }
    };
    window.addEventListener("hrig:buffers-saved", sync);
    return () => window.removeEventListener("hrig:buffers-saved", sync);
  }, [generation]);
  useEffect(() => {
    if (diff) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || !ownsBuffer() || generation.busy) return;
      const captured = capture();
      checking = true;
      try {
        const result = await window.hrig.edit(config.connection, {
          op: "read",
          root: config.root,
          path: config.path,
        });
        const disk = diskRead(result);
        const buffer = buffers.get(id);
        if (!active || !buffer || !ownsBuffer() ||
          !canPublishEditorChange(captured, capture())) return;
        setNotice(previous => previous === DISK_CHECK_FAILURE_NOTICE ? "" : previous);
        if (buffer.revision === disk.revision) return;
        if (
          buffer.content === buffer.saved &&
          preferences["editor.autoReload"]
        ) {
          buffer.content = disk.content;
          buffer.saved = disk.content;
          buffer.revision = disk.revision;
          setValue(disk.content);
          setAcknowledged(null);
          setExternal(null);
          setNotice("Reloaded changes from disk");
        } else setExternal(disk);
      } catch (e) {
        if (active && ownsBuffer() && canPublishEditorChange(captured, capture()))
          setNotice(DISK_CHECK_FAILURE_NOTICE);
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(
      check,
      config.connection.kind === "local" ? 2500 : 8000,
    );
    window.addEventListener("focus", check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [generation, diff, preferences["editor.autoReload"]]);
  const cancelReload = () => {
    if (!ownsBuffer()) return;
    if (generation.busy && reloading) {
      generation.request++;
      generation.busy = false;
      setReloading(false);
    }
    setReloadConfirm(false);
  };
  const reload = async () => {
    const buffer = buffers.get(id);
    if (!buffer || !ownsBuffer() || generation.busy) return;
    generation.busy = true;
    generation.request++;
    const captured = capture();
    setReloading(true);
    setError("");
    try {
      const result = await window.hrig.edit(config.connection, {
        op: "read", root: config.root, path: config.path,
      });
      if (!current(captured, false)) return;
      const disk = diskRead(result);
      if (!current(captured)) {
        setNotice("Reload canceled because you edited this file while it was loading. Your edits are preserved. Choose Reload from disk to try again.");
        setReloadConfirm(false);
        return;
      }
      buffer.content = disk.content;
      buffer.saved = disk.content;
      buffer.revision = disk.revision;
      persist();
      diffRef.current?.setModel(null);
      setCompare(false);
      setExternal(null);
      setAcknowledged(null);
      setValue(disk.content);
      setDirty(false);
      onDirty(id, false);
      setReloadConfirm(false);
      setNotice("Reloaded changes from disk");
    } catch (e) {
      if (!current(captured, false)) return;
      if (!current(captured)) {
        setNotice("Reload canceled because you edited this file while it was loading. Your edits are preserved. Choose Reload from disk to try again.");
      } else {
        setError("Could not reload from disk. Your edits are preserved. Choose Reload from disk to try again.\n" + (e as Error).message);
      }
      setReloadConfirm(false);
    } finally {
      if (ownsBuffer() && buffers.get(id) === buffer && generation.request === captured.request) {
        generation.busy = false;
        setReloading(false);
      }
    }
  };
  // A retained buffer belongs to its registered file, never to a same-id retarget.
  const registered = bufferConfigs.get(id);
  if (!diff && (buffers.get(id) !== generation.buffer ||
    (buffers.has(id) && (!registered || editorChangeOwner(id, registered) !== owner))))
    return <div className="editor-panel"><ErrorBox error="This panel belongs to a different file buffer. Reopen the original file to recover your edits." /></div>;
  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <span>
          <FileCode2 size={13} />
          {config.path}
        </span>
        {!diff && !compare && isMarkdownPath(config.path) && (
          <button
            className="small-button"
            aria-pressed={mdPreview}
            title={mdPreview ? "Back to the editable Markdown source" : "Preview rendered Markdown (read-only; your text is unchanged)"}
            onClick={() => setMdPreview((v) => !v)}
          >
            {mdPreview ? <Code2 size={12} /> : <Eye size={12} />}
            {mdPreview ? "Source" : "Preview"}
          </button>
        )}
        {(diff || compare) && (
          <button
            className="small-button"
            aria-pressed={preferences["editor.diffSideBySide"]}
            title={preferences["editor.diffSideBySide"]
              ? "Showing two columns. Switch to an inline diff (remembered across restarts)."
              : "Showing an inline diff. Switch to two columns (remembered across restarts)."}
            onClick={() =>
              updateSetting(
                Object.hasOwn(projectPreferences, "editor.diffSideBySide") ? "project" : "user",
                "editor.diffSideBySide",
                !preferences["editor.diffSideBySide"],
              )}
          >
            {preferences["editor.diffSideBySide"] ? "Inline" : "Side by side"}
          </button>
        )}
        {diff ? (
          <span className="subtle">HEAD ↔ working tree</span>
        ) : (
          <button
            className={`small-button ${dirty ? "highlight" : ""}`}
            onClick={save}
            disabled={saving || reloading || value === undefined || !!recovery}
          >
            <Save size={12} />
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        )}
      </div>
      {recovery && (
        <div className="external-change" role="status">
          <span>
            Unsaved recovery copy available. Disk content is unchanged.
          </span>
          <button
            className="small-button"
            onClick={() => {
              const b = buffers.get(id);
              if (!b || !currentRecovery()) return;
              generation.edit++;
              const disk = { ...b };
              Object.assign(b, recovery);
              setValue(b.content);
              setDirty(true);
              onDirty(id, true);
              if (disk.revision !== recovery.revision)
                setExternal({ content: disk.content, revision: disk.revision });
              setRecovery(null);
              persist();
            }}
          >
            Restore recovery copy
          </button>
          <button
            className="small-button"
            onClick={() => {
              if (!currentRecovery()) return;
              try {
                draftOperation("delete", recoveryKey);
                setRecovery(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Discard recovery copy
          </button>
        </div>
      )}
      {external && (
        <div className="external-change" role="status">
          <span>
            {acknowledged === external.revision
              ? "Keeping your text. Saving still checks for conflicts. Compare or reload to review the disk changes."
              : "This file changed outside HRig. Your edits are preserved; saving is protected."}
          </span>
          <button
            className="small-button"
            onClick={() => {
              if (!ownsBuffer() || represented.current !== external) return;
              setError("");
              diffRef.current?.setModel(null);
              setCompare((v) => !v);
            }}
          >
            {compare ? "Back to editor" : "Compare with disk"}
          </button>
          <button
            className="small-button"
            disabled={saving || reloading}
            onClick={() => {
              if (ownsBuffer() && represented.current === external && !generation.busy)
                setReloadConfirm(true);
            }}
          >
            {reloading ? "Reloading…" : "Reload from disk"}
          </button>
          {acknowledged !== external.revision && <button
            className="small-button"
            disabled={saving || reloading}
            onClick={() => {
              if (ownsBuffer() && represented.current === external &&
                canAcknowledgeEditorChange(external.revision, represented.current?.revision, generation.busy))
                setAcknowledged(external.revision);
            }}
          >Keep mine</button>}
        </div>
      )}
      {notice && <div className="editor-notice" role="status">{notice}</div>}
      {error && value !== undefined && <ErrorBox error={error} />}
      {inspected && value === undefined ? (
        <FilePreview info={inspected} path={config.path || ""} />
      ) : error && value === undefined ? (
        <ErrorBox error={error} />
      ) : value === undefined ? (
        <Loading text="Opening file…" />
      ) : diff || compare ? (
        <DiffEditor
          onMount={(editor) => {
            if (!generation.active || lifetime.current !== generation ||
              buffers.get(id) !== generation.buffer) return;
            diffRef.current = editor;
            const focus = () => {
              if (generation.active && lifetime.current === generation &&
                editorChangeOwner(id, config, diff) === owner &&
                buffers.get(id) === generation.buffer) editor.focus();
            };
            focusRef.current = focus;
            editorFocusers.set(id, focus);
            if (onReady?.(id)) focus();
          }}
          original={compare ? external?.content ?? "" : original}
          modified={value}
          language={language(config.path)}
          theme="hrig-settings"
          options={{
            ...editorOptions,
            readOnly: true,
            automaticLayout: true,
            renderSideBySide: preferences["editor.diffSideBySide"],
            scrollBeyondLastLine: false,
          }}
        />
      ) : (
        <>
        {mdPreview && isMarkdownPath(config.path) && <MarkdownPreview source={value} />}
        <Editor
          wrapperProps={mdPreview && isMarkdownPath(config.path) ? { style: { display: "none" } } : undefined}
          path={monaco.Uri.from({
            scheme: "file",
            path: editorModelPath(config),
          }).toString()}
          value={value}
          language={language(config.path)}
          theme="hrig-settings"
          onChange={(text) => {
            const b = buffers.get(id);
            if (!b || !ownsBuffer()) return;
            generation.edit++;
            b.content = text || "";
            if (!recovery) persist();
            setValue(b.content);
            const d = b.content !== b.saved;
            setDirty(d);
            onDirty(id, d);
          }}
          onMount={(editor) => {
            if (!ownsBuffer()) return;
            editorRef.current = editor;
            const focus = () => { if (ownsBuffer()) editor.focus(); };
            focusRef.current = focus;
            editorFocusers.set(id, focus);
            if (onReady?.(id)) focus();
            if (config.line) {
              editor.revealLineInCenter(config.line);
              editor.setPosition({ lineNumber: config.line, column: 1 });
            }
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              if (ownsBuffer()) saveRef.current();
            });
          }}
          onValidate={(markers) => {
            if (!ownsBuffer()) return;
            problems.set(
              id,
              markers.map((m) => ({
                path: config.path!,
                line: m.startLineNumber,
                message: m.message,
                severity: m.severity,
                connection: config.connection,
                root: config.root,
              })),
            );
            window.dispatchEvent(new Event("hrig:problems"));
          }}
          options={{
            ...editorOptions,
            automaticLayout: true,
            readOnly: !!recovery,
            lineHeight: Math.round(preferences["editor.fontSize"] * 1.7),
            padding: { top: 16 },
            scrollBeyondLastLine: false,
          }}
        />
        </>
      )}
      {reloadConfirm && (
        <Modal
          title="Discard local edits and reload?"
          subtitle="The version currently on disk will replace your unsaved text."
          onClose={cancelReload}
        >
          <div className="modal-actions editor-reload-actions">
            <button
              className="secondary-button"
              onClick={cancelReload}
            >
              Keep editing
            </button>
            <button
              className="primary-button"
              disabled={saving || reloading}
              onClick={reload}
            >
              {reloading ? "Reloading…" : "Discard edits and reload"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
