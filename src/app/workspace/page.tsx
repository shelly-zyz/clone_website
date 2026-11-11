import { MapAppShell } from "@/components/opengridworks/MapAppShell";
import { resolveWorkspaceTopic } from "@/lib/globe-topics";

export default async function Workspace({ searchParams }: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const { topic } = await searchParams;
  return <MapAppShell initialProject={resolveWorkspaceTopic(topic)} />;
}
