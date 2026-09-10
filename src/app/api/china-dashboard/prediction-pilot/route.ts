import { NextResponse } from "next/server";
import { loadSdwpfPilotSummary } from "@/lib/prediction/pilot-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await loadSdwpfPilotSummary();
    if (!summary) {
      return NextResponse.json({ status: "unavailable", reason: "Local SDWPF pilot summary has not been built." }, { status: 404 });
    }
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "invalid", reason: "Local SDWPF pilot summary could not be read." }, { status: 500 });
  }
}
