import { authorizeDataAgent } from "@/lib/data-agent/http.server";

export const runtime = "nodejs";

const host = "https://dashscope.aliyuncs.com";
const noStore = { "Cache-Control": "no-store" };
const maxRecordingBytes = 16_000 * 2 * 15;
const maxAudioBytes = 2 * 1024 * 1024;
let active = 0;

class BodyTooLarge extends Error {}

async function readBounded(response: Request | Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) throw new BodyTooLarge();
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function waveFromPcm(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function pcmFromWave(wave: Buffer) {
  if (wave.length < 44 || wave.toString("ascii", 0, 4) !== "RIFF" || wave.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid Qwen audio format");
  }
  let validFormat = false;
  for (let offset = 12; offset + 8 <= wave.length;) {
    const kind = wave.toString("ascii", offset, offset + 4);
    const size = wave.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wave.length) break;
    if (kind === "fmt " && size >= 16) {
      validFormat = wave.readUInt16LE(start) === 1 && wave.readUInt16LE(start + 2) === 1
        && wave.readUInt32LE(start + 4) === 24_000 && wave.readUInt16LE(start + 14) === 16;
    }
    if (kind === "data" && validFormat && size > 0 && size % 2 === 0) return wave.subarray(start, end);
    offset = end + (size % 2);
  }
  throw new Error("Unsupported Qwen audio format");
}

export function GET() {
  return Response.json({ enabled: Boolean(process.env.DASHSCOPE_API_KEY?.trim()) }, { headers: noStore });
}

export async function POST(request: Request) {
  const unauthorized = authorizeDataAgent(request);
  if (unauthorized) return unauthorized;
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) return Response.json({ error: "千问语音尚未配置。" }, { status: 503 });
  const action = new URL(request.url).searchParams.get("action");
  const expectedType = action === "transcribe" ? "application/octet-stream" : action === "synthesize" ? "application/json" : undefined;
  if (!expectedType) return Response.json({ error: "无效的语音操作。" }, { status: 400 });
  if (request.headers.get("content-type")?.split(";", 1)[0] !== expectedType) {
    return Response.json({ error: "不支持的语音请求格式。" }, { status: 415 });
  }
  if (active >= 4) return Response.json({ error: "语音服务正在处理其他请求，请稍后再试。" }, { status: 429 });
  active++;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    if (action === "transcribe") {
      const pcm = await readBounded(request, maxRecordingBytes);
      if (pcm.length < 3_200 || pcm.length % 2 !== 0) return Response.json({ error: "录音无效。" }, { status: 400 });
      const response = await fetch(`${host}/compatible-mode/v1/chat/completions`, {
        method: "POST", headers, signal,
        body: JSON.stringify({ model: "qwen3-asr-flash", asr_options: { enable_itn: true },
          messages: [{ role: "user", content: [{ type: "input_audio", input_audio: {
            data: `data:audio/wav;base64,${waveFromPcm(pcm).toString("base64")}`,
          } }] }] }),
      });
      if (!response.ok) throw new Error("Qwen recognition failed");
      const answer: { choices?: { message?: { content?: unknown } }[] } = await response.json();
      const text = answer.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("Invalid Qwen transcript");
      return Response.json({ text: text.trim() }, { headers: noStore });
    }

    const raw = await readBounded(request, 4096);
    let input: { text?: unknown } | null;
    try { input = JSON.parse(raw.toString("utf8")); } catch {
      return Response.json({ error: "无效的播报文本。" }, { status: 400 });
    }
    const text = typeof input?.text === "string" ? input.text.trim() : "";
    if (!text || text.length > 500) return Response.json({ error: "无效的播报文本。" }, { status: 400 });
    const response = await fetch(`${host}/api/v1/services/aigc/multimodal-generation/generation`, {
      method: "POST", headers, signal,
      body: JSON.stringify({ model: "qwen3-tts-flash", input: { text, voice: "Cherry", language_type: "Chinese" } }),
    });
    if (!response.ok) throw new Error("Qwen synthesis failed");
    const answer: { output?: { audio?: { url?: unknown } } } = await response.json();
    const audioUrl = answer.output?.audio?.url;
    if (typeof audioUrl !== "string") throw new Error("Missing Qwen audio");
    const url = new URL(audioUrl);
    if (url.host !== "dashscope-result-bj.oss-cn-beijing.aliyuncs.com" || url.username || url.password
      || (url.protocol !== "https:" && url.protocol !== "http:")) {
      throw new Error("Unexpected Qwen audio location");
    }
    // DashScope can return an HTTP-formatted OSS URL. Fetch the signed object over HTTPS.
    url.protocol = "https:";
    const audio = await fetch(url, { signal, redirect: "error" });
    if (!audio.ok) throw new Error("Qwen audio download failed");
    const pcm = pcmFromWave(await readBounded(audio, maxAudioBytes));
    return Response.json({ audio: pcm.toString("base64") }, { headers: noStore });
  } catch (error) {
    if (error instanceof BodyTooLarge && action === "transcribe") {
      return Response.json({ error: "录音请控制在 15 秒以内。" }, { status: 413 });
    }
    return Response.json({ error: "千问语音暂时不可用，请重试。" }, { status: 502 });
  } finally {
    active--;
  }
}
