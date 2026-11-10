import "server-only";

function allowsGzip(encoding: string) {
  const [name, quality] = encoding.trim().toLowerCase().split(";");
  return name.trim() === "gzip"
    && (quality === undefined || Number(quality.replace(/^\s*q\s*=\s*/, "")) > 0);
}

export function mapJsonResponse(request: Request, data: unknown, headers?: HeadersInit) {
  const response = Response.json(data, { headers });
  response.headers.append("Vary", "Accept-Encoding");
  if (!response.body || !request.headers.get("accept-encoding")?.split(",").some(allowsGzip)) {
    return response;
  }

  response.headers.set("Content-Encoding", "gzip");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), response);
}
