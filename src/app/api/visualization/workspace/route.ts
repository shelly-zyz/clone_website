import { z } from "zod";
import { withBusinessAction } from "@/lib/agent-runtime/policy.server";
import { authorizeXiaoyun, dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { createDataProject } from "@/lib/data-agent/state.server";
import { projectKeySchema, VisualizationError, workspaceRequestSchema } from "@/lib/visualization-agent/research/contracts";
import { researchWorkspace } from "@/lib/visualization-agent/research/service.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const projectHeaders = z.object({ project_id: z.uuid(), key: projectKeySchema });
const topicForDomain = { electricity: "power", meteorology: "meteo", carbon: "carbon", economy: "power" } as const;
const errorStatus = { DATA_GAP: 422, CLARIFICATION: 422, INCOMPATIBLE: 422, ENGINE_UNAVAILABLE: 503,
  VALIDATION_FAILED: 422, CONFLICT: 409, BUSY: 429, NOT_FOUND: 404 } as const;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const respond = (body: object, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  const denied = authorizeXiaoyun(request);
  if (denied) return denied;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 40_000) return respond({ code: "INVALID_REQUEST", error: "工作区请求过大。" }, 413);
  const input = await request.text().catch(() => "");
  if (input.length > 40_000) return respond({ code: "INVALID_REQUEST", error: "工作区请求过大。" }, 413);
  const command = workspaceRequestSchema.safeParse(parseJson(input)).data;
  if (!command) return respond({ code: "INVALID_REQUEST", error: "请检查工作区动作、日期范围和数据引用。" }, 400);
  try {
    if (command.action === "start") return respond(await withBusinessAction("visualization", "research_start",
      () => createDataProject(topicForDomain[command.domain], "科研制图工作区")));
    const access = projectHeaders.safeParse({ project_id: request.headers.get("x-data-project-id"),
      key: request.headers.get("x-data-project-key") }).data;
    if (!access && command.action !== "catalog") return respond({ code: "PROJECT_NOT_FOUND", error: "请打开一个已授权的制图项目。" }, 404);
    const result = await researchWorkspace(command, access ?? { project_id: "", key: "" }, request.signal);
    if ("bytes" in result && result.bytes && result.contentType) return new Response(new Uint8Array(result.bytes), { headers: {
      ...headers, "Content-Type": result.contentType, "Content-Disposition": 'attachment; filename="' + result.filename + '"',
    } });
    return respond(result);
  } catch (error) {
    if (error instanceof VisualizationError) return respond({ code: error.code, error: error.message }, errorStatus[error.code]);
    if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) {
      return respond({ code: "BUSY", error: "制图请求已结束或超时，请缩小范围后重试。" }, 503);
    }
    return dataAgentErrorResponse(error);
  }
}

function parseJson(input: string): unknown {
  try { return JSON.parse(input); } catch { return undefined; }
}
