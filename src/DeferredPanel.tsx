import { useEffect, useRef, useState, type ComponentProps, type ComponentType } from "react";
import type { TabNode } from "flexlayout-react";
import { ErrorBox, Loading } from "./components";
import type EditorPanel from "./EditorPanel";
import type SettingsPage from "./SettingsPage";

type EditorProps = ComponentProps<typeof EditorPanel>;
type SettingsProps = ComponentProps<typeof SettingsPage>;
// Successful modules and concurrent imports are shared; failures are never cached.
function sharedLoader<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let ready: { default: ComponentType<P> } | undefined;
  let pending: Promise<{ default: ComponentType<P> }> | undefined;
  return () => {
    if (ready) return Promise.resolve(ready);
    if (!pending) pending = load().then(module => {
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
const loadEditor = sharedLoader(() => import("./EditorPanel"));
const loadSettings = sharedLoader(() => import("./SettingsPage"));
export const optionalPanelLoaders = { editor: loadEditor, diff: loadEditor, settings: loadSettings };

export default function DeferredPanel({ node, panelProps }: { node: TabNode; panelProps: EditorProps | SettingsProps }) {
  // The prop shape selects the matching typed loader; App supplies the existing
  // project prop for Settings and the existing editor callbacks for editor/diff.
  if ("project" in panelProps)
    return <DeferredContent node={node} panelProps={panelProps} loader={loadSettings} settings />;
  return <DeferredContent node={node} panelProps={panelProps} loader={loadEditor} />;
}

function DeferredContent<P extends object>({ node, panelProps, loader, settings = false }: {
  node: TabNode;
  panelProps: P;
  loader: () => Promise<{ default: ComponentType<P> }>;
  settings?: boolean;
}) {
  const loadingText = settings ? "Opening settings…" : "Opening editor…";
  const errorText = settings
    ? "Could not open settings. Select Retry to try again."
    : "Could not open the editor. Select Retry to try again.";
  const [state, setState] = useState<{ Component?: ComponentType<P>; failed: boolean }>({ failed: false });
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
            <ErrorBox error={errorText} announce={false} />
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
          <div aria-hidden="true"><Loading text={loadingText} announce={false} /></div>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>{loadingText}</span>
        </div>
      )}
    </div>
  );
}
