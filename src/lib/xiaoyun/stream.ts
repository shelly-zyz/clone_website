import type { XiaoyunReply } from "./contracts";

export const xiaoyunStreamType = "application/x-ndjson";
export const greetingReply = "我在。";

export function stripGreeting(message: string) {
  const text = message.trim();
  const greeting = /^(?:(?:你好|您好|嗨|哈喽|hello|hey)[\s，,。！!？?]*小云|小云[\s，,。！!？?]*(?:你好|您好|在吗|在不在)|小云|你好|您好|嗨|哈喽)(?=$|[\s，,。！!？?]|(?:帮我|请|我想))/i;
  return text.replace(greeting, "").replace(/^[\s，,。！!？?]+/, "");
}

export type XiaoyunUpdate = { type: "text" | "progress"; text: string };
export type XiaoyunStreamEvent = XiaoyunUpdate
  | { type: "result"; reply: XiaoyunReply }
  | { type: "error"; error: string };

export async function* streamLines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) yield line.trim();
      if (done) break;
    }
    if (buffered.trim()) yield buffered.trim();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
