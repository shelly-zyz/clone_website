import { speakable } from "./follow-ups";
import { streamLines, type XiaoyunStreamEvent } from "./stream";

type RecognitionOptions = {
  request: (action: string, body: ArrayBuffer | string, signal: AbortSignal, session?: string) =>
    Promise<{ text?: string; session?: string }>;
  onText: (text: string) => void;
  signal: AbortSignal;
};

export function streamRecognition({ request, onText, signal }: RecognitionOptions) {
  const recording: ArrayBuffer[] = [];
  let pending: ArrayBuffer[] = [];
  let uploaded: Promise<void> = Promise.resolve();
  let failed = false;
  let finished = false;
  const upstream = new AbortController();
  const channel = AbortSignal.any([signal, upstream.signal]);
  const opened = request("recognize-start", "", channel).then(response => response.session).catch(() => undefined);
  const collect = () => {
    const batch = joinPcm(pending);
    pending = [];
    return batch;
  };
  const cancel = () => {
    upstream.abort();
    void opened.then(id => {
      if (id && !finished) void request("recognize-cancel", "", AbortSignal.timeout(2_000), id).catch(() => {});
    });
  };
  signal.addEventListener("abort", cancel, { once: true });
  return {
    append(pcm: ArrayBuffer) {
      if (signal.aborted) return;
      recording.push(pcm);
      if (failed) return;
      pending.push(pcm);
      if (pending.length < 6) return;
      const batch = collect();
      uploaded = uploaded.then(async () => {
        const id = await opened;
        if (!id || failed || signal.aborted) { failed = true; return; }
        const { text } = await request("recognize-append", batch, channel, id);
        if (text && !signal.aborted) onText(text);
      }).catch(() => { failed = true; });
    },
    async finish() {
      const backup = new AbortController();
      const backupSignal = AbortSignal.any([signal, backup.signal]);
      const backupStart = Promise.withResolvers<void>();
      const hedge = setTimeout(() => backupStart.resolve(), 600);
      const deadline = setTimeout(cancel, 2_500);
      const realtime = (async () => {
        const id = await opened;
        await uploaded;
        if (failed || !id) throw new Error("实时语音连接未完成。");
        const { text } = await request("recognize-finish", collect(), channel, id);
        finished = true;
        if (!text) throw new Error("实时语音未识别出文字。");
        return text;
      })().catch(error => {
        backupStart.resolve();
        throw error;
      });
      const batch = backupStart.promise.then(async () => {
        backupSignal.throwIfAborted();
        const { text } = await request("transcribe", joinPcm(recording), backupSignal);
        if (!text) throw new Error("未识别出文字。");
        return text;
      });
      try {
        return await Promise.any([realtime, batch]);
      } finally {
        clearTimeout(hedge);
        clearTimeout(deadline);
        backup.abort();
        backupStart.resolve();
        if (!channel.aborted) cancel();
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}

function joinPcm(chunks: ArrayBuffer[]) {
  const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

export function pcmBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

export function streamTurn(update: (value: { caption?: string; speak?: string }) => void, signal: AbortSignal) {
  let text = "";
  let cursor = 0;
  let spoken = false;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let voicedProgress = false;
  const speak = (sentence: string) => {
    const voice = speakable(sentence).trim();
    if (!voice || /^[\s*#-]*(?:要不要我|建议[：:])/.test(voice)) return;
    spoken = true;
    update({ caption: text, speak: voice });
  };
  return {
    async read(body: ReadableStream<Uint8Array>) {
      try {
        for await (const line of streamLines(body)) {
          signal.throwIfAborted();
          const event: XiaoyunStreamEvent = JSON.parse(line);
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "result") return event.reply;
          if (event.type === "progress") {
            update({ caption: event.text });
            if (!progressTimer && !spoken && !voicedProgress) {
              progressTimer = setTimeout(() => {
                if (!signal.aborted && !spoken) {
                  voicedProgress = true;
                  update({ speak: event.text });
                }
              }, 1_800);
            }
            continue;
          }
          clearTimeout(progressTimer);
          text += event.text;
          const content = text.split(/(?:^|\n)[ \t*]*(?:建议[：:])/)[0];
          update({ caption: content });
          const start = cursor;
          const complete = content.slice(start).matchAll(/[^。！？!?\n]+[。！？!?]+|[^\n]+\n/g);
          for (const match of complete) {
            if (/建议[：:]/.test(match[0])) break;
            speak(match[0]);
            cursor = start + (match.index ?? 0) + match[0].length;
          }
        }
        throw new Error("小云的回应中途断开，请重试。");
      } finally {
        clearTimeout(progressTimer);
      }
    },
    finish(summary: string, followUp?: string) {
      const remainder = text.slice(cursor).split(/(?:^|\n)[ \t*]*(?:建议[：:])/)[0].trim();
      if (spoken && remainder) speak(remainder);
      if (!spoken) update({ caption: summary, speak: summary });
      if (followUp) update({ speak: followUp });
    },
  };
}
