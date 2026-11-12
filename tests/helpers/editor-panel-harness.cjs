const assert = require('node:assert/strict');
const { mountComponent } = require('./virtual-list-harness.cjs');

// Only platform boundaries are inert. EditorPanel, editor-buffers, drafts and
// any production decision helper are loaded from the checkout in the same VM.
// This is a source-consumer harness, not native React/Monaco/AT evidence.
function mountEditorPanel(options = {}) {
  const requests = [], pending = [], draftCalls = [], dirtyCalls = [], savedCalls = [];
  const widgetCalls = [];
  const draftStore = JSON.parse(JSON.stringify(options.drafts || {}));
  const config = options.config || {
    connection: { id: 'synthetic-editor', name: 'Synthetic', kind: 'local', root: '/synthetic' },
    root: '/synthetic/project', path: 'example.ts',
  };
  const props = {
    id: 'synthetic-panel', config, diff: false,
    onDirty: (id, dirty) => dirtyCalls.push([id, dirty]),
    onSaved: () => savedCalls.push('saved'),
    ...options.props,
  };
  const api = new Proxy({
    file(owner, request) {
      requests.push({ owner, request });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    edit(owner, request) {
      requests.push({ owner, request });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    drafts(request) {
      draftCalls.push(JSON.parse(JSON.stringify(request)));
      if (request.op === 'list') return { result: JSON.parse(JSON.stringify(draftStore)) };
      if (request.op === 'put') draftStore[request.key] = JSON.parse(JSON.stringify(request.value));
      else if (request.op === 'delete') delete draftStore[request.key];
      else throw new Error(`Unexpected draft operation: ${request.op}`);
      return { result: true };
    },
  }, { get(target, key) {
    if (key in target) return target[key];
    throw new Error(`Unexpected editor API: ${String(key)}`);
  } });
  let registry, drafts, react, actualModal;
  function widget(kind) {
    return function InertEditor(props) {
      react.useEffect(() => {
        const editor = {
          focus: () => widgetCalls.push([kind, 'focus']),
          setModel: value => widgetCalls.push([kind, 'setModel', value]),
          revealLineInCenter() {}, setPosition() {},
          addCommand: (key, callback) => widgetCalls.push([kind, 'command', key, callback]),
          dispose: () => widgetCalls.push([kind, 'dispose']),
        };
        props.onMount?.(editor);
        return () => editor.dispose();
      }, []);
      return react.createElement(kind, props);
    };
  }
  const Worker = class InertWorker {};
  const view = mountComponent('src/EditorPanel.tsx', 'default', props, {
    api, windowEvents: true, onRender: options.onRender,
    globals: { self: {}, Event: class SyntheticEvent { constructor(type) { this.type = type; } } },
    settings: { effective: { 'editor.fontSize': 13, 'editor.autoReload': false,
      'editor.wordWrap': 'off', 'editor.diffSideBySide': true, ...options.preferences } },
    dependencies: {
      '@monaco-editor/react': { default: widget('inert-editor'), DiffEditor: widget('inert-diff'), loader: { config() {} } },
      'monaco-editor': { editor: { defineTheme() {}, setTheme() {} },
        Uri: { from: value => ({ toString: () => `${value.scheme}:${value.path}` }) },
        KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } },
      'monaco-editor/editor/editor.worker.js?worker': { default: Worker },
      'monaco-editor/language/json/json.worker.js?worker': { default: Worker },
      'monaco-editor/language/typescript/ts.worker.js?worker': { default: Worker },
      './themes': { themeId: () => 'synthetic', editorTheme: () => ({}) },
      './components': {
        Loading: props => react.createElement('loading', null, props.text),
        ErrorBox: props => react.createElement('error-box', null, props.error),
        Modal: props => options.actualModal ? react.createElement(actualModal, props, props.children) : react.createElement('section', { role: 'dialog', 'aria-label': props.title },
          props.title, props.subtitle,
          react.createElement('button', { onClick: props.onClose, 'aria-label': 'Close dialog' }, 'Close dialog'),
          props.children),
      },
    },
    root(context) {
      react = context.react;
      registry = context.load('src/editor-buffers.ts');
      drafts = context.load('src/drafts.ts');
      if (options.actualModal) actualModal = context.load('src/components.tsx').Modal;
      options.seed?.({ registry, drafts, props, draftStore });
      return context.load('src/EditorPanel.tsx').default;
    },
  });
  return Object.assign(view, {
    props, registry, drafts, requests, pending, draftCalls, draftStore, dirtyCalls, savedCalls, widgetCalls,
    retarget(next) { Object.assign(props, next); view.update(next); },
    dispatch(type, extra = {}) {
      for (const fn of [...(view.listeners.get(type) || [])]) fn({ type, stopPropagation() {}, ...extra });
      view.flush();
    },
    button(label) { return view.nodes().find(n => n.type === 'button' && view.text(n) === label); },
    click(label) {
      const button = this.button(label);
      assert.ok(button, `Expected reachable button: ${label}`);
      assert.ok(!button.props.disabled, `Expected enabled button: ${label}`);
      view.event(button, 'onClick');
    },
    editor() { return view.nodes().find(n => n.type === 'inert-editor'); },
    comparison() { return view.nodes().find(n => n.type === 'inert-diff'); },
    type(text) {
      const editor = this.editor();
      assert.ok(editor, 'Expected editable local text');
      assert.ok(!editor.props.options.readOnly, 'Expected writable editor');
      editor.props.onChange(text); view.flush();
    },
    focusWindow() { for (const fn of [...(view.listeners.get('focus') || [])]) fn({ type: 'focus' }); view.flush(); },
    async resolve(index, value) { assert.ok(pending[index], `Expected request ${index}`); pending[index].resolve(value); await view.settle(); },
    async reject(index, error) { assert.ok(pending[index], `Expected request ${index}`); pending[index].reject(error); await view.settle(); },
    buffer() { return registry.buffers.get(props.id); },
    draftBytes() { return JSON.stringify(draftStore); },
    visibleText() { return view.nodes().filter(n => n.parentElement === null).map(n => view.text(n)).join(''); },
  });
}

module.exports = { mountEditorPanel };
