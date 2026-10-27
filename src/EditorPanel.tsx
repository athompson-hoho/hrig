import { useEffect, useState, useRef } from "react";
import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import { Save, FileCode2 } from "lucide-react";
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
  const { effective: preferences } = useSettings();
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
  const [value, setValue] = useState<string | undefined>(
    buffers.get(id)?.content,
  );
  const [original, setOriginal] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [external, setExternal] = useState<{
    content: string;
    revision: string;
  } | null>(null);
  const [compare, setCompare] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const recoveryKey = draftKey(
    "editor",
    config.connection,
    config.root,
    config.path,
  );
  const [recovery, setRecovery] = useState<{
    content: string;
    saved: string;
    revision: string;
  } | null>(() => {
    if (diff || buffers.has(id)) return null;
    try {
      return readDraft(recoveryKey)?.data || null;
    } catch (e) {
      return null;
    }
  });
  const persist = () => {
    try {
      persistBuffer(id);
    } catch (e) {
      setError("Recovery copy: " + (e as Error).message);
    }
  };
  useEffect(() => {
    const cleared = () => {
      try {
        if (!readDraft(recoveryKey)) setRecovery(null);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    window.addEventListener("hrig:drafts-cleared", cleared);
    return () => window.removeEventListener("hrig:drafts-cleared", cleared);
  }, [recoveryKey]);
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
    if (!buffer) return;
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
      buffer.saved = content;
      buffer.revision = result.revision;
      persist();
      const changed = buffer.content !== content;
      setDirty(changed);
      onDirty(id, changed);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;
  useEffect(() => {
    if (!diff) bufferConfigs.set(id, config);
    let active = true;
    const read = window.hrig.edit(config.connection, {
      op: "read",
      root: config.root,
      path: config.path,
    });
    (diff
      ? Promise.all([
          read.catch(() => ({ content: "" })),
          window.hrig.file(config.connection, {
            op: "original",
            root: config.root,
            path: config.path,
          }),
        ])
      : Promise.all([read])
    )
      .then(([current, base]) => {
        if (!active) return;
        if (diff) setOriginal(base.content);
        else if (!buffers.has(id))
          buffers.set(id, {
            content: current.content,
            saved: current.content,
            revision: current.revision,
          });
        setValue(buffers.get(id)?.content ?? current.content);
        const b = buffers.get(id);
        const isDirty = !!b && b.content !== b.saved;
        setDirty(isDirty);
        if (!diff) onDirty(id, isDirty);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      if (editorFocusers.get(id) === focusRef.current)
        editorFocusers.delete(id);
      // Detach first: the React Monaco wrapper disposes models before its widget.
      // Newer Monaco diff widgets require the model to be reset before disposal.
      diffRef.current?.setModel(null);
      diffRef.current = null;
    };
  }, [id]);
  useEffect(() => {
    const sync = () => {
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
  }, [id]);
  useEffect(() => {
    if (diff) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const current = await window.hrig.edit(config.connection, {
          op: "read",
          root: config.root,
          path: config.path,
        });
        const buffer = buffers.get(id);
        if (!active || !buffer || buffer.revision === current.revision) return;
        if (
          buffer.content === buffer.saved &&
          preferences["editor.autoReload"]
        ) {
          buffer.content = current.content;
          buffer.saved = current.content;
          buffer.revision = current.revision;
          setValue(current.content);
          setNotice("Reloaded changes from disk");
        } else setExternal(current);
      } catch (e) {
        if (active) setNotice("Disk check: " + (e as Error).message);
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
  }, [id, diff, preferences["editor.autoReload"]]);
  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <span>
          <FileCode2 size={13} />
          {config.path}
        </span>
        {diff ? (
          <span className="subtle">HEAD ↔ working tree</span>
        ) : (
          <button
            className={`small-button ${dirty ? "highlight" : ""}`}
            onClick={save}
            disabled={saving || value === undefined || !!recovery}
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
              if (!b) return;
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
        <div className="external-change">
          <span>
            This file changed outside HRig. Your edits are preserved; saving is
            protected.
          </span>
          <button
            className="small-button"
            onClick={() => {
              setError("");
              diffRef.current?.setModel(null);
              setCompare((v) => !v);
            }}
          >
            {compare ? "Back to editor" : "Compare with disk"}
          </button>
          <button
            className="small-button"
            onClick={() => setReloadConfirm(true)}
          >
            Reload from disk
          </button>
        </div>
      )}
      {!external && notice && <div className="editor-notice">{notice}</div>}
      {error && value !== undefined && <ErrorBox error={error} />}
      {error && value === undefined ? (
        <ErrorBox error={error} />
      ) : value === undefined ? (
        <Loading text="Opening file…" />
      ) : diff || compare ? (
        <DiffEditor
          onMount={(editor) => {
            diffRef.current = editor;
            const focus = () => editor.focus();
            focusRef.current = focus;
            editorFocusers.set(id, focus);
            if (onReady?.(id)) focus();
          }}
          original={compare ? external?.content || "" : original}
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
        <Editor
          path={monaco.Uri.from({
            scheme: "file",
            path: editorModelPath(config),
          }).toString()}
          value={value}
          language={language(config.path)}
          theme="hrig-settings"
          onChange={(text) => {
            const b = buffers.get(id);
            if (!b) return;
            b.content = text || "";
            if (!recovery) persist();
            setValue(b.content);
            const d = b.content !== b.saved;
            setDirty(d);
            onDirty(id, d);
          }}
          onMount={(editor) => {
            editorRef.current = editor;
            const focus = () => editor.focus();
            focusRef.current = focus;
            editorFocusers.set(id, focus);
            if (onReady?.(id)) focus();
            if (config.line) {
              editor.revealLineInCenter(config.line);
              editor.setPosition({ lineNumber: config.line, column: 1 });
            }
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
              saveRef.current(),
            );
          }}
          onValidate={(markers) => {
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
      )}
      {reloadConfirm && (
        <Modal
          title="Discard local edits and reload?"
          subtitle="The version currently on disk will replace your unsaved text."
          onClose={() => setReloadConfirm(false)}
        >
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setReloadConfirm(false)}
            >
              Keep editing
            </button>
            <button
              className="primary-button"
              onClick={async () => {
                try {
                  const disk = await window.hrig.edit(config.connection, {
                    op: "read",
                    root: config.root,
                    path: config.path,
                  });
                  const b = buffers.get(id)!;
                  b.content = disk.content;
                  b.saved = disk.content;
                  b.revision = disk.revision;
                  persist();
                  diffRef.current?.setModel(null);
                  setCompare(false);
                  setExternal(null);
                  setValue(disk.content);
                  setDirty(false);
                  onDirty(id, false);
                  setReloadConfirm(false);
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Discard edits and reload
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
