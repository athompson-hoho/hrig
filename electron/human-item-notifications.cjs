"use strict";

const OPEN_QUEUE_CHANNEL = "human-item:open-queue";

function registerHumanItemNotifications({ handle, Notification, getWindow }) {
  handle("human-item:notify", (_event, title, body, connectionId) => {
    if (
      !Notification.isSupported() ||
      typeof title !== "string" ||
      typeof body !== "string" ||
      typeof connectionId !== "string" ||
      !connectionId ||
      connectionId.length > 150 ||
      /[\x00-\x1f\x7f]/.test(connectionId)
    )
      return false;

    const notification = new Notification({
      title: title.slice(0, 150),
      body: body.slice(0, 300),
      silent: true,
    });
    notification.on("click", () => {
      const window = getWindow();
      if (!window || window.webContents.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      window.webContents.send(OPEN_QUEUE_CHANNEL, connectionId);
    });
    notification.show();
    return true;
  });
}

module.exports = { registerHumanItemNotifications };
