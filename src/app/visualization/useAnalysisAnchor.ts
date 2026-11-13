"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const readAnchor = () => window.location.hash.slice(1);
const readServerAnchor = () => "";

export function useAnalysisAnchor() {
  return useSyncExternalStore(subscribe, readAnchor, readServerAnchor);
}
