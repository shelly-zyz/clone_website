import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { DataAgentError } from "./database.server";

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

// Next can construct request.url using the server's bind address, not the browser's host.
function matchesRequestHost(origin: string, host: string | null, requestUrl: URL) {
  try {
    const caller = new URL(origin);
    return caller.origin === origin && caller.host === host && caller.protocol === requestUrl.protocol;
  } catch {
    return false;
  }
}

export function authorizeDataAgent(request: Request, reviewer = false) {
  const token = (reviewer ? process.env.DATA_AGENT_REVIEW_TOKEN : process.env.DATA_AGENT_TOKEN)?.trim();
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin && !matchesRequestHost(origin, request.headers.get("host"), url)) {
    return Response.json({ error: "来源不受信任。" }, { status: 403 });
  }
  if (!reviewer && !token && process.env.NODE_ENV !== "production" && loopbackHosts.includes(url.hostname)) return null;
  const supplied = request.headers.get("authorization");
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (token && supplied && timingSafeEqual(hash(supplied), hash(`Bearer ${token}`))) return null;
  return Response.json({ error: "数据库 Agent 需要服务端授权。" }, { status: 401 });
}

export function dataAgentErrorResponse(error: unknown) {
  if (error instanceof DataAgentError) {
    const statuses = { NOT_CONFIGURED: 503, VERSION_NOT_FOUND: 404, INVALID_METRIC: 422, INVALID_SERIES: 422,
      INVALID_REGION: 422, PROJECT_NOT_FOUND: 404, SESSION_CONFLICT: 409, REVIEW_CONFLICT: 409, BUSY: 429 } as const;
    return Response.json({ code: error.code, error: error.message }, { status: statuses[error.code] });
  }
  return Response.json({ code: "UNAVAILABLE", error: "数据库 Agent 暂时不可用。" }, { status: 503 });
}
