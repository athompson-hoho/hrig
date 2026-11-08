import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { Connection } from "./types";
import {
  DROP_ENDED_NOTICE,
  dropInsertText,
  dropNotice,
  dropRefusal,
  dropShell,
  isFileDrag,
} from "./terminal-drop-path";

const NOTICE_MS = 6000;

/** Inserts the quoted path of a file dropped on a local terminal at the prompt, through the terminal's own paste and never with Enter; a drag that is not a file (a tab, text) is never touched. */
export default function TerminalFileDrop({
  host,
  terminal,
  connection,
  rigControl,
  ready,
  ended,
  localShell,
}: {
  host: RefObject<HTMLElement | null>;
  terminal: RefObject<Terminal | null>;
  connection: Connection;
  rigControl: boolean;
  ready: boolean;
  ended: number | null;
  localShell: string;
}) {
  const [notice, setNotice] = useState("");
  // The listeners below are attached once per host element, so this ref is how they read the latest render.
  const latest = useRef({ connection, rigControl, ready, ended, localShell });
  latest.current = { connection, rigControl, ready, ended, localShell };
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let depth = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const say = (text: string) => {
      clearTimeout(timer);
      setNotice(text);
      timer = setTimeout(() => setNotice(""), NOTICE_MS);
    };
    const refusal = () => {
      const now = latest.current;
      return dropRefusal({
        kind: now.connection.kind,
        rigControl: now.rigControl,
        ready: now.ready,
        ended: now.ended,
      });
    };
    const mark = (on: boolean) =>
      element.classList.toggle("file-drop-active", on);
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      depth++;
      if (refusal() === "") mark(true);
    };
    const over = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      // Cancelling dragover is what lets the drop event fire, so a terminal that refuses can still explain why.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) mark(false);
    };
    const drop = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      event.preventDefault();
      depth = 0;
      mark(false);
      const term = terminal.current;
      const problem = refusal();
      if (problem || !term) {
        say(problem || DROP_ENDED_NOTICE);
        return;
      }
      const list = event.dataTransfer?.files;
      const files: File[] = list ? Array.from(list) : [];
      const paths: string[] = [];
      try {
        for (const file of files) paths.push(window.hrig.pathForFile(file));
      } catch {
        say("The dropped file's path could not be read. Nothing was inserted.");
        return;
      }
      const result = dropInsertText(
        paths,
        dropShell(window.hrig.platform, latest.current.localShell),
      );
      if ("error" in result) {
        say(result.error);
        return;
      }
      term.paste(result.text);
      term.focus();
      say(dropNotice(result.count));
    };
    element.addEventListener("dragenter", enter);
    element.addEventListener("dragover", over);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragenter", enter);
      element.removeEventListener("dragover", over);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
      clearTimeout(timer);
      mark(false);
    };
  }, [host]);
  return notice ? (
    <div className="editor-notice" role="status">
      {notice}
    </div>
  ) : null;
}
