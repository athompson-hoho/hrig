import { useEffect, useState } from "react";
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
  const [error, setError] = useState("");
  const [value, setValue] = useState<T>(() => {
    try {
      return readDraft(key)?.data ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      draftOperation("put", key, { kind, ...metadata, data: value });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [key, value]);
  return [value, setValue, error] as const;
}
