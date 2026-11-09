// Separate from generic terminal alerts: this boundary accepts seat names only.
function validSeatNotificationName(value) {
  return typeof value === 'string' && value.trim().length > 0 &&
    Array.from(value).length <= 150 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function registerSeatNotifications({ handle, Notification }) {
  handle('seat:notify-attention', (_event, ...args) => {
    try {
      if (args.length !== 1) return { status: 'ignored' };
      const request = args[0];
      if (!request || typeof request !== 'object' ||
        Object.getPrototypeOf(request) !== Object.prototype) return { status: 'ignored' };
      const keys = Reflect.ownKeys(request);
      if (keys.length !== 1 || keys[0] !== 'seatName') return { status: 'ignored' };
      const descriptor = Object.getOwnPropertyDescriptor(request, 'seatName');
      if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
        !validSeatNotificationName(descriptor.value)) return { status: 'ignored' };
      if (!Notification.isSupported()) return { status: 'ignored' };
      const notification = new Notification({ title: descriptor.value, silent: true });
      let failed = false;
      // Consume asynchronous failure without logging details, retrying or acting.
      notification.on('failed', () => { failed = true; });
      notification.show();
      // This acknowledges a request only. Later OS failure cannot imply delivery.
      return { status: failed ? 'ignored' : 'requested' };
    } catch {
      return { status: 'ignored' };
    }
  });
}

module.exports = { registerSeatNotifications };
