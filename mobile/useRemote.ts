import { useEffect, useRef, useState } from "react";

export function useRemote<T>(
  enabled: boolean,
  key: string,
  read: () => Promise<T>,
  interval = 10000,
) {
  const reader = useRef(read);
  reader.current = read;
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    value: T | null;
    error: string;
    status: number;
    loading: boolean;
    updated: number | null;
  }>({
    key,
    value: null,
    error: "",
    status: 0,
    loading: enabled,
    updated: null,
  });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    setSnapshot((previous) =>
      previous.key === key
        ? { ...previous, loading: true }
        : {
            key,
            value: null,
            error: "",
            status: 0,
            loading: true,
            updated: null,
          },
    );
    async function load() {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(load, 3000);
        return;
      }
      try {
        const value = await reader.current();
        if (!disposed) {
          setSnapshot({
            key,
            value,
            error: "",
            status: 0,
            loading: false,
            updated: Date.now(),
          });
          failures = 0;
        }
      } catch (error) {
        if (!disposed)
          setSnapshot((previous) => ({
            ...previous,
            key,
            error: (error as Error).message,
            status: (error as { status?: number }).status || 0,
            loading: false,
          }));
        failures++;
        if ((error as { status?: number }).status === 401) return;
      }
      if (!disposed && interval > 0)
        timer = setTimeout(
          load,
          Math.min(30000, interval * 2 ** Math.min(failures, 2)),
        );
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled, key, revision, interval]);
  const current =
    snapshot.key === key
      ? snapshot
      : {
          key,
          value: null,
          error: "",
          status: 0,
          loading: enabled,
          updated: null,
        };
  return { ...current, retry: () => setRevision((value) => value + 1) };
}
