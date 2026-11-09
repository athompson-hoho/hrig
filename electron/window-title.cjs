"use strict";

// The one way the page can change the title of the application window. The page is not trusted to send a safe title: every value is read again here, cut, cleaned and made to end with the app name, and only the window the call came from is ever touched.
const APP_TITLE = "hRig";
const SEPARATOR = " - ";
const MAX_TITLE = 100;
const MAX_INPUT = 1024;
const ENDING = SEPARATOR + APP_TITLE;
// Lone surrogates, control characters (white space is handled apart), soft hyphen, zero-width and direction characters, annotation marks and tag characters. The zero-width joiner and the variation selectors stay: emoji sequences need them.
const DROPPED =
  /[\ud800-\udfff]|[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\ufff9-\ufffb]|[\u{e0000}-\u{e007f}]/gu;

function windowTitle(value) {
  if (typeof value !== "string") return APP_TITLE;
  const text = value
    .slice(0, MAX_INPUT)
    .replace(DROPPED, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === APP_TITLE) return APP_TITLE;
  const name = text.endsWith(ENDING) ? text.slice(0, -ENDING.length) : text;
  const room = MAX_TITLE - Array.from(ENDING).length;
  const kept = Array.from(name)
    .slice(0, room)
    .join("")
    .replace(/[\s\u200d]+$/u, "");
  return kept ? kept + ENDING : APP_TITLE;
}

function registerWindowTitle({ handle, getWindow }) {
  handle("window:title", (event, value) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || !event || event.sender !== win.webContents)
      throw new Error("Untrusted application window.");
    win.setTitle(windowTitle(value));
  });
}

module.exports = { APP_TITLE, MAX_TITLE, windowTitle, registerWindowTitle };
