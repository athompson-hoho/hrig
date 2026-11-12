"use strict";
// Opt-in native spellcheck for HRig's own text boxes (E15). It uses Electron's built-in checker only:
// no word list is bundled, no text is sent anywhere by HRig, and the code editor is NOT covered
// (Monaco marks its input surfaces spellcheck="false" and draws text in its own elements).
//
// Default OFF. While off, the session has the checker disabled and NO language set, so no dictionary is
// requested. Turning it on sets one language: on Windows and Linux Electron then downloads that language's
// dictionary file (a word list, never your text) from the Chromium CDN once; macOS uses the OS checker.

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

/** Turns the checker on or off for a session. On needs a language (not on macOS); otherwise it stays off. */
function applySpellcheck(session, enabled, env = {}) {
  if (typeof enabled !== "boolean") throw new Error("Spellcheck needs a boolean.");
  if (!session) return { enabled: false, language: null };
  if (!enabled) {
    session.setSpellCheckerEnabled(false);
    session.setSpellCheckerLanguages([]);
    return { enabled: false, language: null };
  }
  if (env.platform === "darwin") {
    session.setSpellCheckerEnabled(true);
    return { enabled: true, language: "system" };
  }
  const language = pickLanguage(env.locale, session.availableSpellCheckerLanguages);
  if (!language) {
    session.setSpellCheckerEnabled(false);
    session.setSpellCheckerLanguages([]);
    return { enabled: false, language: null };
  }
  session.setSpellCheckerLanguages([language]);
  session.setSpellCheckerEnabled(true);
  return { enabled: true, language };
}

function registerSpellcheck({ app, ipcMain, getSession, trusted, platform = process.platform }) {
  const env = () => ({ platform, locale: app.getLocale() });
  // Off before the window exists: this handler is registered ahead of the window-creating one.
  app.whenReady().then(() => applySpellcheck(getSession(), false, env()));
  ipcMain.handle("spellcheck:set", (event, ...args) => {
    trusted(event);
    if (args.length !== 1 || typeof args[0] !== "boolean") throw new Error("Spellcheck needs one boolean.");
    return applySpellcheck(getSession(), args[0], env());
  });
}

module.exports = { pickLanguage, applySpellcheck, registerSpellcheck };
