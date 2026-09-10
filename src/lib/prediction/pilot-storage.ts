import { promises as fs } from "node:fs";
import path from "node:path";
import type { SdwpfPilotSummary } from "../china-dashboard";

export async function loadSdwpfPilotSummary(): Promise<SdwpfPilotSummary | null> {
  const summaryPath = path.join(process.cwd(), ".forecast-data", "sdwpf", "pilot-summary.json");
  try {
    const value = JSON.parse(await fs.readFile(summaryPath, "utf8")) as unknown;
    if (!isSdwpfPilotSummary(value)) throw new Error("Invalid SDWPF pilot summary schema.");
    return value;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function isSdwpfPilotSummary(value: unknown): value is SdwpfPilotSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.status === "historical-backtest-only"
    && typeof candidate.generatedAt === "string"
    && typeof candidate.source === "object"
    && typeof candidate.dataset === "object"
    && typeof candidate.baseline === "object";
}
