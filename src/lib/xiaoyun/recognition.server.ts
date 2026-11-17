import "server-only";

import { randomUUID } from "node:crypto";
import type { WebSocket as NodeWebSocket } from "undici-types";

const connect = globalThis.WebSocket as unknown as typeof NodeWebSocket;
const maxBytes = 16_000 * 2 * 15;

type ProviderEvent = {
  header: { event: string };
  payload?: { output?: { sentence?: { text?: string; sentence_end?: boolean } } };
};

function openRecognition(key: string) {
  const id = randomUUID();
  const socket = new connect("wss://dashscope.aliyuncs.com/api-ws/v1/inference", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const ready = Promise.withResolvers<void>();
  const result = Promise.withResolvers<string>();
  void ready.promise.catch(() => {});
  void result.promise.catch(() => {});
  const sentences: string[] = [];
  let partial = "";
  let bytes = 0;
  let finishing = false;
  const end = (error?: Error) => {
    clearTimeout(timeout);
    sessions.delete(id);
    if (error) {
      ready.reject(error);
      result.reject(error);
    }
    socket.close();
  };
  const timeout = setTimeout(() => end(new Error("语音识别超时。")), 22_000);
  function send(action: "run-task" | "finish-task", payload: object) {
    socket.send(JSON.stringify({ header: { action, task_id: id, streaming: "duplex" }, payload }));
  }
  socket.addEventListener("open", () => send("run-task", {
    task_group: "audio", task: "asr", function: "recognition", model: "paraformer-realtime-v2",
    parameters: { format: "pcm", sample_rate: 16_000, language_hints: ["zh"], max_sentence_silence: 400 },
    input: {},
  }));
  socket.addEventListener("message", ({ data }) => {
    try {
      const event: ProviderEvent = JSON.parse(String(data));
      switch (event.header.event) {
        case "task-started": ready.resolve(); break;
        case "result-generated": {
          const sentence = event.payload?.output?.sentence;
          if (!sentence?.text) break;
          partial = sentence.text;
          if (sentence.sentence_end) {
            sentences.push(partial);
            partial = "";
          }
          break;
        }
        case "task-finished":
          result.resolve([...sentences, partial].join("").trim());
          end();
          break;
        case "task-failed": end(new Error("实时语音识别失败。")); break;
      }
    } catch {
      end(new Error("语音识别返回了无效事件。"));
    }
  });
  const closed = () => end(new Error("实时语音识别已断开。"));
  socket.addEventListener("error", closed, { once: true });
  socket.addEventListener("close", closed, { once: true });
  return {
    id,
    async append(pcm: Buffer, finish: boolean) {
      if (finishing || pcm.length % 2 || (bytes += pcm.length) > maxBytes) throw new Error("语音输入无效。");
      if (finish) finishing = true;
      await ready.promise;
      if (pcm.length) socket.send(pcm);
      if (!finish) return partial;
      send("finish-task", { input: {} });
      return result.promise;
    },
    cancel: () => end(new Error("语音识别已取消。")),
  };
}

const sessions = new Map<string, ReturnType<typeof openRecognition>>();

export function startRecognition(key: string) {
  if (sessions.size >= 8) return;
  const session = openRecognition(key);
  sessions.set(session.id, session);
  return session.id;
}

export function recognitionSession(id: string | null) {
  return id && sessions.get(id) || undefined;
}
