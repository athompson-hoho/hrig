"use strict";
// Opt-in native spellcheck for HRig's own text boxes (E15). It uses Electron's built-in checker only:
// no word list is bundled, no text is sent anywhere by HRig, and the code editor is NOT covered
// (Monaco marks its input surfaces spellcheck="false" and draws text in its own elements).
//
// Default OFF. While off, HRig keeps the session's checker disabled with NO language set, so no dictionary
// should be requested (code- and test-verified; that Chromium fetches nothing before our first call is a
// display check, see HUMAN-UAT E15). Turning it on sets one language: on Windows and Linux Electron then downloads that language's
// dictionary file (a word list, never your text) from the Chromium CDN once; macOS uses the OS checker.

// Where Electron/Chromium fetch hunspell dictionaries by default, and an inert loopback address used while the
// setting is OFF so that even an unexpected early fetch cannot leave the machine. Not on macOS (system checker).
const DEFAULT_DICTIONARY_URL = "https://redirector.gvt1.com/edgedl/chrome/dict/";
const INERT_DICTIONARY_URL = "http://127.0.0.1:9/";

/** One spellcheck language: the app locale if Electron offers it, else its base language, else en-US, else none. */
function pickLanguage(locale, available) {
  const list = Array.isArray(available) ? available.filter((l) => typeof l === "string" && l) : [];
  const wanted = typeof locale === "string" ? locale : "";
  if (wanted && list.includes(wanted)) return wanted;
  const base = wanted.split(/[-_]/)[0].toLowerCase();
  if (base) {
    const near = list.find((l) => l.split(/[-_]/)[0].toLowerCase() === base);
    if (near) return near;
  }
  return list.includes("en-US") ? "en-US" : null;
}

/** The OFF state: inert download URL first, then no language, checker disabled. */
function turnOff(session) {
  session.setSpellCheckerDictionaryDownloadURL(INERT_DICTIONARY_URL);
  session.setSpellCheckerLanguages([]);
  session.setSpellCheckerEnabled(false);
  return { enabled: false, language: null };
}

/** Turns the checker on or off for a session. On needs a language (not on macOS); otherwise it stays off. */
function applySpellcheck(session, enabled, env = {}) {
  if (typeof enabled !== "boolean") throw new Error("Spellcheck needs a boolean.");
  if (!session) return { enabled: false, language: null };
  if (!enabled) return turnOff(session);
  if (env.platform === "darwin") {
    session.setSpellCheckerEnabled(true);
    return { enabled: true, language: "system" };
  }
  const language = pickLanguage(env.locale, session.availableSpellCheckerLanguages);
  if (!language) return turnOff(session);
  // The real download URL is restored only here, at the moment the user opts in.
  session.setSpellCheckerDictionaryDownloadURL(DEFAULT_DICTIONARY_URL);
  session.setSpellCheckerLanguages([language]);
  session.setSpellCheckerEnabled(true);
  return { enabled: true, language };
}

function registerSpellcheck({ app, ipcMain, getSession, trusted, platform = process.platform }) {
  const env = () => ({ platform, locale: app.getLocale() });
  // Off as early as Electron allows: when any session is created (its language list is cleared before first
  // use), and again once the app is ready, ahead of the window-creating handler. A language persisted from an
  // earlier opt-in is cleared the same way, so an off setting starts without one.
  app.on("session-created", (session) => {
    try {
      applySpellcheck(session, false, env());
    } catch {}
  });
  app.whenReady().then(() => applySpellcheck(getSession(), false, env()));
  ipcMain.handle("spellcheck:set", (event, ...args) => {
    trusted(event);
    if (args.length !== 1 || typeof args[0] !== "boolean") throw new Error("Spellcheck needs one boolean.");
    return applySpellcheck(getSession(), args[0], env());
  });
}

module.exports = { DEFAULT_DICTIONARY_URL, INERT_DICTIONARY_URL, pickLanguage, applySpellcheck, registerSpellcheck };
