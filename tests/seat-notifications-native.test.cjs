const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Execute only selected production registrations, never Electron's main entry.
// Every Notification below is an inert recorder; no native module is loaded.
function nativeHarness(options = {}) {
  const handlers = new Map(), requests = [], notifications = [], unexpected = [];
  const pending = [], sender = {};
  let preload;
  const plain = value => JSON.parse(JSON.stringify(value));
  class Notification {
    static isSupported() {
      if (options.fail === 'support') throw Error('SYNTHETIC_PRIVATE_NATIVE');
      return options.supported !== false;
    }
    constructor(config) {
      if (options.fail === 'constructor') throw Error('SYNTHETIC_PRIVATE_NATIVE');
      const record = { options: plain(config), shows: 0, listeners: [] };
      notifications.push(record);
      this.record = record;
    }
    on(name, callback) { this.record.listeners.push({ name, callback }); return this; }
    once(name, callback) { return this.on(name, callback); }
    show() {
      if (options.fail === 'show') throw Error('SYNTHETIC_PRIVATE_NATIVE');
      this.record.shows++;
    }
  }
  const text = fs.readFileSync('electron/main.cjs', 'utf8');
  const root = ts.createSourceFile('main.cjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const trusted = root.statements.filter(n => ts.isVariableStatement(n) &&
    n.declarationList.declarations.some(d => d.name.getText(root) === 'trusted'));
  const handle = root.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handle');
  const generic = root.statements.filter(n => ts.isExpressionStatement(n) &&
    ts.isCallExpression(n.expression) && n.expression.expression.getText(root) === 'handle' &&
    n.expression.arguments[0]?.text === 'attention:notify');
  assert.equal(trusted.length, 1, 'actual main trusted sender seam is unique');
  assert.equal(handle.length, 1, 'actual main handle wrapper is unique');
  assert.equal(generic.length, 1, 'existing generic notification registration is unique');
  // A later production registration is composed only when main actually wires it.
  // Absence is never the baseline RED assertion; current generic routing runs now.
  const dedicated = root.statements.filter(n => ts.isExpressionStatement(n) &&
    n.getText(root).includes('registerSeatNotifications'));
  assert.ok(dedicated.length <= 1, 'at most one actual dedicated registration');
  const context = {
    mainWindow: { webContents: sender }, Notification,
    ipcMain: { handle(channel, fn) { assert.ok(!handlers.has(channel)); handlers.set(channel, fn); } },
    require(id) {
      assert.equal(id, './seat-notifications.cjs', 'only the actual wired inert native adapter may load');
      return require('../electron/seat-notifications.cjs');
    },
  };
  vm.runInNewContext([...trusted, ...handle, ...generic, ...dedicated]
    .map(n => n.getText(root)).join('\n'), context);
  const forbidden = (name, args) => {
    unexpected.push({ name, args });
    throw Error('Unexpected non-notification capability: ' + name);
  };
  const dispatch = (event, channel, args) => {
    requests.push({ channel, args });
    const handler = handlers.get(channel);
    if (!handler) return Promise.reject(Error('Unregistered actual IPC channel: ' + channel));
    const result = handler(event, ...args);
    if (event.sender === sender) pending.push(result);
    return result;
  };
  vm.runInNewContext(fs.readFileSync('electron/preload.cjs', 'utf8'), {
    process: { platform: 'synthetic' },
    require(id) {
      assert.equal(id, 'electron');
      return {
        contextBridge: { exposeInMainWorld(name, api) { assert.equal(name, 'hrig'); preload = api; } },
        ipcRenderer: {
          // Electron IPC serializes into the receiving realm. Keep raw() below
          // unmodified for strict descriptor/prototype/extra-key refusal checks.
          invoke: (channel, ...args) => dispatch({ sender }, channel, structuredClone(args)),
          send: (...args) => forbidden('send', args),
          sendSync: (...args) => forbidden('sendSync', args),
          on: (...args) => forbidden('on', args),
          removeListener: (...args) => forbidden('removeListener', args),
        },
      };
    },
  });
  return {
    preload, requests, notifications, unexpected,
    async flush() { while (pending.length) await Promise.all(pending.splice(0)); },
    untrusted: (channel, ...args) => dispatch({ sender: {} }, channel, args),
    raw: (channel, ...args) => dispatch({ sender }, channel, args),
    failNotification(index = 0) {
      for (const listener of notifications[index].listeners.filter(l => l.name === 'failed'))
        listener.callback({}, 'SYNTHETIC_PRIVATE_NATIVE');
    },
  };
}

if (require.main === module) {
  test('actual preload and trusted generic native route preserve terminal title body and silent behavior', async () => {
    const h = nativeHarness();
    await h.preload.notifyAttention('Synthetic terminal bell', 'Synthetic terminal host');
    await h.flush();
    assert.deepEqual(h.notifications.map(n => n.options), [{
      title: 'Synthetic terminal bell', body: 'Synthetic terminal host', silent: true,
    }]);
    assert.equal(h.notifications[0].shows, 1);
    assert.deepEqual(h.notifications[0].listeners, []);
    assert.deepEqual(h.unexpected, []);
  });
  test('actual trusted main wrapper refuses foreign sender before generic native effects', async () => {
    const h = nativeHarness();
    await assert.rejects(h.untrusted('attention:notify', 'Synthetic title', 'Synthetic body'),
      /Untrusted application window/);
    assert.deepEqual(h.notifications, []);
    assert.deepEqual(h.unexpected, []);
    await h.preload.notifyAttention('Trusted contrast', 'Synthetic body');
    await h.flush();
    assert.equal(h.notifications.length, 1);
    assert.equal(h.notifications[0].shows, 1);
  });
  test('actual generic native route has no constructor or show when support is unavailable', async () => {
    const h = nativeHarness({ supported: false });
    await h.preload.notifyAttention('Synthetic terminal bell', 'Synthetic terminal host');
    await h.flush();
    assert.deepEqual(h.notifications, []);
    assert.deepEqual(h.unexpected, []);
  });
}

module.exports = { nativeHarness };
