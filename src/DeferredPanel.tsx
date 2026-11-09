import { useEffect, useRef, useState, type ComponentProps, type ComponentType } from "react";
import type { TabNode } from "flexlayout-react";
import { ErrorBox, Loading } from "./components";
import type EditorPanel from "./EditorPanel";

type EditorProps = ComponentProps<typeof EditorPanel>;
// Successful modules and concurrent imports are shared; failures are never cached.
function editorLoader() {
  let ready: { default: ComponentType<EditorProps> } | undefined;
  let pending: Promise<{ default: ComponentType<EditorProps> }> | undefined;
  return () => {
    if (ready) return Promise.resolve(ready);
    if (!pending) pending = import("./EditorPanel").then(module => {
      ready = module;
      pending = undefined;
      return module;
    }, error => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
const loadEditor = editorLoader();
export const optionalPanelLoaders = { editor: loadEditor, diff: loadEditor };

export default function DeferredPanel({ node, panelProps }: { node: TabNode; panelProps: EditorProps }) {
  const loader = optionalPanelLoaders[node.getComponent() as keyof typeof optionalPanelLoaders];
  const [state, setState] = useState<{ Component?: ComponentType<EditorProps>; failed: boolean }>({ failed: false });
  const [visible, setVisible] = useState(() => node.isVisible());
  const active = useRef(false);
  const attempt = useRef(0);
  const inflight = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const begin = () => {
    if (!active.current || inflight.current) return;
    inflight.current = true;
    const token = ++attempt.current;
    setState({ failed: false });
    Promise.resolve().then(loader).then(module => {
      if (active.current && attempt.current === token) {
        inflight.current = false;
        setState({ Component: module.default, failed: false });
      }
    }, () => {
      if (active.current && attempt.current === token) {
        inflight.current = false;
        setState({ failed: true });
      }
    });
  };
  useEffect(() => {
    active.current = true;
    setVisible(node.isVisible());
    node.setEventListener("visibility", ({ visible }) => setVisible(visible));
    begin();
    return () => {
      active.current = false;
      attempt.current++;
      inflight.current = false;
      node.removeEventListener("visibility");
    };
  }, [node, loader]);
  if (state.Component) {
    const Component = state.Component;
    return <Component {...panelProps} />;
  }
  return (
    <div className="deferred-panel" ref={host} aria-busy={!state.failed}>
      {state.failed ? (
        <>
          <div role={visible ? "alert" : undefined}>
            <ErrorBox error="Could not open the editor. Select Retry to try again." />
          </div>
          <button type="button" className="small-button" ref={retry} onClick={() => {
            if (!node.isVisible()) return;
            const button = retry.current;
            const doc = button?.ownerDocument;
            // Move only focus still owned by the disappearing Retry, synchronously.
            if (button && doc?.activeElement === button) {
              host.current?.closest<HTMLElement>(".navigation-panel-content")?.focus({ preventScroll: true });
            }
            begin();
          }}>Retry</button>
        </>
      ) : (
        <div role={visible ? "status" : undefined} aria-live={visible ? "polite" : "off"} aria-atomic="true">
          <div aria-hidden="true"><Loading text="Opening editor…" /></div>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>Opening editor…</span>
        </div>
      )}
    </div>
  );
}
