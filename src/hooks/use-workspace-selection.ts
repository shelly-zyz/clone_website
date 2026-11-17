import { useCallback, useEffect, useRef, useState } from "react";
import { resolveWorkspaceTopic, type WorkspaceTopic } from "@/lib/globe-topics";
import {
  readWorkspaceContext, recallWorkspace, rememberWorkspace, workspaceContextHref, type WorkspaceContext,
} from "@/lib/workspace-context";

export type WorkspaceSelection = { topic: WorkspaceTopic; context: WorkspaceContext };

export function useWorkspaceSelection(initial: WorkspaceSelection, onTopic: (next: WorkspaceSelection) => void) {
  const [selection, setSelection] = useState(initial);
  const current = useRef(initial);

  const assign = useCallback((next: WorkspaceSelection) => {
    const topicChanged = current.current.topic !== next.topic;
    current.current = next;
    setSelection(next);
    if (topicChanged) onTopic(next);
  }, [onTopic]);

  const navigate = useCallback((topic: WorkspaceTopic, patch: WorkspaceContext = {}, replace = false) => {
    const previous = current.current.topic;
    if (topic !== previous) rememberWorkspace(previous);
    const fromUrl = readWorkspaceContext(new URLSearchParams(window.location.search));
    const saved = topic === previous ? fromUrl : recallWorkspace(topic);
    const context = { ...saved, ...patch };
    const href = workspaceContextHref(topic, context);
    if (href !== window.location.pathname + window.location.search) {
      if (replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    }
    rememberWorkspace(topic);
    assign({ topic, context });
  }, [assign]);

  useEffect(() => {
    rememberWorkspace(current.current.topic);
    const restore = () => {
      if (window.location.pathname !== "/workspace") return;
      const search = new URLSearchParams(window.location.search);
      const topic = resolveWorkspaceTopic(search.get("topic"));
      const context = readWorkspaceContext(search);
      rememberWorkspace(topic);
      if (current.current.topic === topic) onTopic({ topic, context });
      assign({ topic, context });
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [assign, onTopic]);

  return { ...selection, navigate };
}
