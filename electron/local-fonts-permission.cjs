function registerLocalFontsPermission({ session, dialog, getWindow }) {
  let decision = null;
  const trustedWindow = (contents) => {
    const window = getWindow();
    return !!window && !window.isDestroyed() && contents === window.webContents;
  };

  session.setPermissionCheckHandler((contents, permission) =>
    permission === "local-fonts" && decision === true && trustedWindow(contents),
  );
  session.setPermissionRequestHandler((contents, permission, callback) => {
    if (permission !== "local-fonts" || !trustedWindow(contents)) {
      callback(false);
      return;
    }
    if (decision !== null) {
      callback(decision);
      return;
    }

    const window = getWindow();
    dialog
      .showMessageBox(window, {
        type: "question",
        title: "Local font access for terminal ligatures",
        message: "Allow HRig to read local font data for terminal ligatures?",
        detail:
          "Font data stays on this device and is not sent or stored by HRig. If you deny access, terminals use built-in fallback ranges when available.",
        buttons: ["Not now", "Allow while HRig is open"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        decision = response === 1;
        callback(decision);
      })
      .catch(() => {
        decision = false;
        callback(false);
      });
  });
}

module.exports = { registerLocalFontsPermission };
