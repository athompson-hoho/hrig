const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Controlled DOM geometry only. All component rendering and range decisions
// come from production source, including nested function components.
function mountComponent(file, exportName, initialProps, options = {}) {
  const instances = new Map(), dom = new Map(), modules = new Map();
  const observers = new Set(), pending = [];
  const document = { activeElement: null };
  let current, dirty = true, tree, props = initialProps, serial = 0;
  const element = (type, props, key) => ({ type, key, props: props || {} });
  function effect(fn, deps) {
    const owner = current, i = owner.cursor++, old = owner.slots[i];
    if (!old || !deps || deps.some((v, j) => !Object.is(v, old.deps?.[j]))) {
      owner.slots[i] = { deps, cleanup: old?.cleanup };
      pending.push(() => { old?.cleanup?.(); owner.slots[i].cleanup = fn(); });
    }
  }
  const react = {
    useState(initial) {
      const owner = current, i = owner.cursor++;
      if (!(i in owner.slots)) owner.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [owner.slots[i], value => {
        const next = typeof value === 'function' ? value(owner.slots[i]) : value;
        if (!Object.is(next, owner.slots[i])) { owner.slots[i] = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = current.cursor++; return current.slots[i] ??= { current: initial }; },
    useId() { const i = current.cursor++; return current.slots[i] ??= `list-test-${++serial}`; },
    useEffect: effect, useLayoutEffect: effect,
    useMemo(fn, deps) {
      const i = current.cursor++, old = current.slots[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current.slots[i] = { deps, value: fn() };
      return current.slots[i].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    createElement(type, props, ...children) { return element(type, { ...props, children }, props?.key); },
    cloneElement(node, props) { return element(node.type, { ...node.props, ...props }, props.key ?? node.key); },
    isValidElement: node => !!node && typeof node === 'object' && 'type' in node,
  };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
    observe(node) { this.targets.add(node); }
    unobserve(node) { this.targets.delete(node); }
    disconnect() { this.targets.clear(); observers.delete(this); }
  }
  function load(filename) {
    filename = path.resolve(filename);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    modules.set(filename, exports);
    const dependencies = {
      react,
      'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
      'lucide-react': new Proxy({}, { get: (_, key) => String(key) }),
      './SettingsContext': { useSettings: () => ({ effective: { 'appearance.density': 'compact' } }) },
      './components': { ErrorBox: 'error-box', Loading: 'loading', StatusDot: 'status-dot', Empty: 'empty' },
      './RigDesigner': { default: 'rig-designer', DeleteRig: 'delete-rig' },
      '../electron/diagnostics-bundle.mjs': {},
    };
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, document, ResizeObserver,
      window: { hrig: options.api || {} },
      require(id) {
        if (id in dependencies) return dependencies[id];
        if (id.startsWith('.')) {
          const base = path.resolve(path.dirname(filename), id);
          const target = [base, `${base}.ts`, `${base}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
          if (!target) throw new Error(`Missing actual dependency: ${id}`);
          return load(target);
        }
        throw new Error(`Unexpected test dependency: ${id}`);
      },
    }, { filename });
    return exports;
  }
  const Component = load(file)[exportName];
  function descendants(node) { return [node, ...(node.children || []).flatMap(descendants)]; }
  function render(value, location, parent, seenInstances, seenDom) {
    if (Array.isArray(value)) return value.flatMap((v, i) => render(v, `${location}/${v?.key ?? i}`, parent, seenInstances, seenDom));
    if (value == null || typeof value === 'boolean') return [];
    if (typeof value !== 'object') return [String(value)];
    // A keyed single child remounts too, not only keyed array children.
    if (value.key != null) location = `${location}/key:${value.key}`;
    if (typeof value.type === 'function') {
      let instance = instances.get(location);
      if (!instance || instance.type !== value.type) {
        instance = { type: value.type, slots: [], cursor: 0 };
        instances.set(location, instance);
      }
      seenInstances.add(location);
      const previous = current; current = instance; instance.cursor = 0;
      const output = value.type(value.props); current = previous;
      return render(output, `${location}/output`, parent, seenInstances, seenDom);
    }
    seenDom.add(location);
    let node = dom.get(location);
    if (!node || node.type !== value.type) {
      node = {
        type: value.type, scrollTop: 0, clientHeight: options.height ?? 330, clientWidth: options.width ?? 600,
        getBoundingClientRect() { return { height: this.measuredHeight ?? options.rowHeight ?? 55, width: this.clientWidth }; },
        contains(target) { return descendants(this).includes(target); },
        matches(selector) { return selector.includes('button') && this.type === 'button' && !this.props.disabled; },
        focus() { document.activeElement = this; },
        querySelectorAll(selector) {
          return descendants(this).slice(1).filter(n => n && typeof n === 'object' &&
            (selector.includes('button') ? n.type === 'button' && !n.props.disabled : false));
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
        getAttribute(name) { return this.props[name] == null ? null : String(this.props[name]); },
        scrollTo(value) { this.scrollTop = value.top; },
      };
      dom.set(location, node);
    }
    node.props = value.props; node.parentElement = parent;
    node.children = render(value.props.children, `${location}/children`, node, seenInstances, seenDom);
    const ref = value.props.ref;
    if (node.ref !== ref) {
      if (typeof node.ref === 'function') node.ref(null);
      else if (node.ref) node.ref.current = null;
      node.ref = ref;
      if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
    }
    return [node];
  }
  function flush() {
    for (let attempts = 0; dirty || pending.length; attempts++) {
      if (attempts > 40) throw new Error('Component did not settle');
      if (dirty) {
        dirty = false;
        const seenInstances = new Set(), seenDom = new Set();
        tree = render(element(Component, props), 'root', null, seenInstances, seenDom);
        for (const [key, instance] of instances) if (!seenInstances.has(key)) {
          for (const slot of instance.slots) slot?.cleanup?.(); instances.delete(key);
        }
        for (const [key, node] of dom) if (!seenDom.has(key)) {
          if (typeof node.ref === 'function') node.ref(null); else if (node.ref) node.ref.current = null;
          dom.delete(key);
        }
      }
      while (pending.length) pending.shift()();
    }
    return tree;
  }
  const nodes = () => tree.flatMap(descendants).filter(n => typeof n === 'object');
  flush();
  return {
    nodes, flush, document, observers,
    text(node) { return descendants(node).filter(n => typeof n === 'string').join(''); },
    update(next) { props = { ...props, ...next }; dirty = true; flush(); },
    async settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); flush(); } },
    event(node, name, extra = {}) {
      const event = { target: node, currentTarget: node, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...extra };
      node.props[name]?.(event); flush(); return event;
    },
    resize(node, height, width = node.clientWidth) {
      node.measuredHeight = height; node.clientHeight = height; node.clientWidth = width;
      for (const observer of [...observers]) if (observer.targets.has(node)) {
        observer.callback([{ target: node, contentRect: { height, width }, borderBoxSize: [{ blockSize: height, inlineSize: width }] }]);
      }
      flush();
    },
    unmount() {
      for (const instance of instances.values()) for (const slot of instance.slots) slot?.cleanup?.();
      for (const node of dom.values()) {
        if (typeof node.ref === 'function') node.ref(null); else if (node.ref) node.ref.current = null;
      }
      instances.clear(); dom.clear(); tree = [];
    },
  };
}

module.exports = { mountComponent };
