export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const defaultLangGraphUrl = "http://127.0.0.1:2024";
const defaultAssistantId = "agent";
const requestTimeoutMs = 120_000;

type LangGraphMessage = {
  role?: unknown;
  type?: unknown;
  content?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field : null;
}

function normalizeBaseUrl(value: string | undefined) {
  return (value?.trim() || defaultLangGraphUrl).replace(/\/+$/, "");
}

async function postJson(url: string, body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? safeJson(text) : {};

    if (!response.ok) {
      const detail = isRecord(payload) && typeof payload.detail === "string"
        ? payload.detail
        : text || response.statusText;
      throw new Error(`LangGraph ${response.status}: ${detail}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function ensureThread(apiUrl: string, threadId: string | null) {
  if (threadId) {
    return threadId;
  }

  const payload = await postJson(`${apiUrl}/threads`, {});
  if (isRecord(payload)) {
    const createdId = textField(payload, "thread_id") ?? textField(payload, "id");
    if (createdId) {
      return createdId;
    }
  }

  throw new Error("LangGraph did not return a thread id.");
}

function getMessages(payload: unknown): LangGraphMessage[] {
  const candidates = [
    payload,
    isRecord(payload) ? payload.values : null,
    isRecord(payload) ? payload.output : null,
    isRecord(payload) ? payload.result : null,
  ];

  for (const candidate of candidates) {
    if (isRecord(candidate) && Array.isArray(candidate.messages)) {
      return candidate.messages.filter(isRecord) as LangGraphMessage[];
    }
  }

  return [];
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (isRecord(part)) {
          if (typeof part.text === "string") {
            return part.text;
          }
          if (typeof part.content === "string") {
            return part.content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (isRecord(content) && typeof content.text === "string") {
    return content.text;
  }

  return "";
}

function assistantReply(payload: unknown) {
  const messages = getMessages(payload);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = typeof message.role === "string" ? message.role : null;
    const type = typeof message.type === "string" ? message.type : null;

    if (role === "assistant" || type === "ai") {
      const text = contentToText(message.content).trim();
      if (text) {
        return text;
      }
    }
  }

  return "LangGraph 已返回结果，但没有找到可直接展示的助手消息。";
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "LangGraph 响应超时，请稍后再试。";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "DeepAgent 请求失败。";
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const message = isRecord(body) && typeof body.message === "string" ? body.message.trim() : "";
    const incomingThreadId = isRecord(body) && typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : null;

    if (!message) {
      return Response.json({ error: "请输入问题。" }, { status: 400 });
    }

    const apiUrl = normalizeBaseUrl(process.env.LANGGRAPH_API_URL);
    const assistantId = process.env.LANGGRAPH_ASSISTANT_ID?.trim() || defaultAssistantId;
    const threadId = await ensureThread(apiUrl, incomingThreadId);
    const payload = await postJson(`${apiUrl}/threads/${encodeURIComponent(threadId)}/runs/wait`, {
      assistant_id: assistantId,
      input: {
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
      },
      config: {
        configurable: {
          thread_id: threadId,
        },
      },
    });

    return Response.json({
      threadId,
      answer: assistantReply(payload),
    });
  } catch (error: unknown) {
    return Response.json(
      {
        error: errorMessage(error),
        hint: "请确认 deepagent 目录中的 LangGraph 服务已在 2024 端口启动。",
      },
      { status: 503 },
    );
  }
}
