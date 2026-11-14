import type { WorkspaceTopic } from "./globe-topics";

type Handoff = { topic: WorkspaceTopic; frame?: string };
let active: Handoff | null = null;
let timeout: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function update(next: Handoff | null) {
  active = next;
  listeners.forEach(listener => listener());
}

export function beginGlobeHandoff(topic: WorkspaceTopic, frame?: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  clearTimeout(timeout);
  update({ topic, frame });
  timeout = setTimeout(() => update(null), 2400);
}

export function finishGlobeHandoff(topic: WorkspaceTopic) {
  if (active?.topic !== topic) return;
  clearTimeout(timeout);
  update(null);
}

export function subscribeGlobeHandoff(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const getGlobeHandoff = () => active;
export const noGlobeHandoff = () => null;
