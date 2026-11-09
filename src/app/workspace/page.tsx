import { MapAppShell } from "@/components/opengridworks/MapAppShell";

export default async function Workspace({ searchParams }: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const { topic } = await searchParams;
  const initialProject = topic === "weather" || topic === "carbon" ? topic : "power";
  return <MapAppShell initialProject={initialProject} />;
}
