import { normalizeTitle } from "./panel-title";

/** The title every window has by default, and the last words of every longer title. */
export const APP_TITLE = "hRig";

/** The most characters (code points) a window title may have, the app name included. */
export const MAX_WINDOW_TITLE = 100;

/** The most characters the panel name takes in the title; a longer name ends with an ellipsis. */
export const MAX_PANEL_PART = 50;

/** The most characters the project name takes in the title; a longer name keeps its start and its end around an ellipsis. */
export const MAX_PROJECT_PART = 40;

/** What stands between the parts of a title. */
export const TITLE_SEPARATOR = " - ";

/** What the builder reads: the project name, the active panel's name and whether the setting is on. */
export interface WindowTitleInput {
  project?: unknown;
  panel?: unknown;
  enabled?: unknown;
}

const ELLIPSIS = "\u2026";
const MAX_NAME = 200;
const MAX_ROOT = 4096;
const MAX_INPUT = 2048;
// Invisible characters the panel title cleaner keeps: soft hyphen, Mongolian vowel separator, annotation marks and the unassigned or deprecated format characters; the main process drops them too.
const INVISIBLE = /[\u00ad\u180e\u2065\u206a-\u206f\ufff9-\ufffb]/g;

function clean(value: unknown): string | null {
  return normalizeTitle(
    typeof value === "string"
      ? value.slice(0, MAX_INPUT).replace(INVISIBLE, "")
      : value,
    MAX_NAME,
  );
}

function fit(text: string, max: number, middle: boolean): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (!middle)
    return (
      chars
        .slice(0, max - 1)
        .join("")
        .replace(/[\s\u200d]+$/u, "") + ELLIPSIS
    );
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return (
    chars
      .slice(0, head)
      .join("")
      .replace(/[\s\u200d]+$/u, "") +
    ELLIPSIS +
    chars
      .slice(chars.length - tail)
      .join("")
      .replace(/^[\s\u200d\ufe0e\ufe0f]+/u, "")
  );
}

/** The name of a project folder as the title shows it: the last part of the path, with either kind of slash, a trailing slash ignored. A drive root such as C:\ keeps its backslash, a path of slashes only gives its first character, and anything that is not text, or is empty, gives an empty name. */
export function projectNameOf(root: unknown): string {
  if (typeof root !== "string") return "";
  const text = root.slice(-MAX_ROOT).trim();
  const last = text
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1);
  if (last === undefined) return text.charAt(0);
  return /^[A-Za-z]:$/.test(last) ? last + "\\" : last;
}

/** The window title: the panel name, the project name and the app name, joined by " - ", for example "Build logs - hrig - hRig". Anything that is not exactly enabled gives plain "hRig", and so does a title with no usable name. Both names are cleaned like a panel title (control, zero-width and direction characters dropped, white space collapsed), the panel is cut to 50 characters, the project to 40 around an ellipsis and the whole title never has more than 100. Nothing but these two names ever enters it. */
export function buildWindowTitle(input?: WindowTitleInput | null): string {
  if (!input || typeof input !== "object" || input.enabled !== true)
    return APP_TITLE;
  const panel = clean(input.panel);
  const project = clean(input.project);
  const parts: string[] = [];
  if (panel) parts.push(fit(panel, MAX_PANEL_PART, false));
  if (project) parts.push(fit(project, MAX_PROJECT_PART, true));
  parts.push(APP_TITLE);
  return parts.join(TITLE_SEPARATOR);
}
