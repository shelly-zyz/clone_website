import { MapAppShell } from "@/components/opengridworks/MapAppShell";
import { resolveWorkspaceTopic } from "@/lib/globe-topics";
import { readWorkspaceContext } from "@/lib/workspace-context";

export default async function Workspace({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") search.set(name, value);
  }

  return <MapAppShell initialProject={resolveWorkspaceTopic(search.get("topic"))} initialContext={readWorkspaceContext(search)} />;
}
