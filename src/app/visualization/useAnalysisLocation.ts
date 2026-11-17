"use client";

import { useSyncExternalStore } from "react";

const changed = "opengridworks:analysis-query";

function subscribe(onChange: () => void) {
  window.addEventListener(changed, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(changed, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function useAnalysisQuery(initialQuery: string) {
  const query = useSyncExternalStore(subscribe, () => window.location.search.slice(1), () => initialQuery);
  return new URLSearchParams(query);
}

export function updateAnalysisQuery(values: Record<string, string | undefined>, anchor?: string, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (anchor !== undefined) url.hash = anchor;
  if (url.href === window.location.href) return;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(changed));
  if (anchor !== undefined) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
