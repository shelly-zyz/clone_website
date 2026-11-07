import type { Metadata } from "next";
import { EnergyWorkbench } from "@/components/energy/EnergyWorkbench";
import { energyPiConfig } from "@/lib/energy-agent/pi.server";

export const metadata: Metadata = { title: "能源智能体工作台 · OpenGridWorks" };
export const dynamic = "force-dynamic";

export default function EnergyPage() {
  return <EnergyWorkbench model={energyPiConfig()?.model.id ?? null} />;
}
