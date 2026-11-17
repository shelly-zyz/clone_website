import { useEffect, useState } from "react";

export function useWorkspaceResource<T>(path: string | null) {
  const [result, setResult] = useState<{ path: string; data: T | null }>();
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void fetch(path, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Workspace data unavailable");
      return await response.json() as T;
    }).then(data => {
      if (!controller.signal.aborted) setResult({ path, data });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ path, data: null });
    });
    return () => controller.abort();
  }, [path]);

  const current = path && result?.path === path ? result : null;
  return { data: current?.data ?? null, pending: Boolean(path && !current) };
}
