import { queryDatabase } from "@/lib/db";
import { runDataAgentWrite } from "@/lib/data-agent/database.server";
import { authorizeXiaoyun } from "@/lib/data-agent/http.server";
import { getPiModel } from "@/lib/data-agent/pi.server";
import { listDataCatalog } from "@/lib/data-agent/query.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = authorizeXiaoyun(request);
  if (denied) return denied;
  const [database, catalog, sessions] = await Promise.allSettled([
    queryDatabase("SELECT 1"),
    listDataCatalog(),
    runDataAgentWrite("green_agent_context", client => client.query(`
      SELECT 1 FROM projects.data_project LIMIT 0;
      SELECT 1 FROM projects.data_session LIMIT 0;
      SELECT 1 FROM projects.map_assistant_thread LIMIT 0;
      SELECT 1 FROM projects.agent_session LIMIT 0
    `)),
  ]);
  let modelConfigured = false;
  try {
    getPiModel();
    modelConfigured = true;
  } catch {
    // The UI reports configuration state without exposing provider credentials.
  }
  return Response.json({
    database: database.status === "fulfilled",
    dataAgent: catalog.status === "fulfilled" && catalog.value.datasets.length > 0,
    sessions: sessions.status === "fulfilled",
    modelConfigured,
    voiceConfigured: Boolean(process.env.DASHSCOPE_API_KEY?.trim()),
  }, { headers: { "Cache-Control": "no-store" } });
}
