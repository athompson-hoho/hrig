import { useRef, useState, type SetStateAction } from "react";
import type { Connection } from "./types";
export function draftKey(
  kind: string,
  connection: Connection,
  root: string,
  extra = "",
) {
  return JSON.stringify([
    kind,
    connection.id,
    connection.kind,
    connection.host || "",
    connection.port || "",
    connection.distro || "",
    connection.rigBinary || "",
    root,
    extra,
  ]);
}
export function draftOperation(op: string, key?: string, value?: unknown) {
  const response = window.hrig.drafts({ op, key, value });
  if (response.error) throw new Error(response.error);
  return response.result;
}
export function readDraft(key: string) {
  return draftOperation("list")[key];
}
export function useDraft<T>(
  key: string,
  kind: string,
  initial: T,
  metadata: object = {},
) {
  const [loaded] = useState(() => {
    try {
      return { value: readDraft(key)?.data ?? initial, error: "" };
    } catch (e) {
      return { value: initial, error: (e as Error).message };
    }
  });
  const [error, setError] = useState(loaded.error);
  const [value, setValue] = useState<T>(loaded.value);
  const current = useRef(value);
  // Callers mount with a key for the endpoint/project/recipient. Persist before
  // returning from each event so closing a panel cannot outrun an effect.
  const update = (action: SetStateAction<T>) => {
    const next =
      typeof action === "function"
        ? (action as (value: T) => T)(current.current)
        : action;
    try {
      draftOperation("put", key, { kind, ...metadata, data: next });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    current.current = next;
    setValue(next);
  };
  return [value, update, error] as const;
}
