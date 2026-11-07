"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, Send, Sparkles, X } from "lucide-react";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  error?: boolean;
};

type DeepAgentResponse = {
  threadId?: string;
  answer?: string;
  error?: string;
  hint?: string;
};

const starterMessage: ChatMessage = {
  id: "starter",
  role: "assistant",
  content: "你好，我是 OpenGridWorks DeepAgent。可以问我图层、数据口径、电网设施或新能源场景相关问题。",
};

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function DeepAgentChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([starterMessage]);
  const [input, setInput] = useState("");
  const [token, setToken] = useState("");
  const [needsToken, setNeedsToken] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.sessionStorage.getItem("og-map-assistant-thread"));
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, open]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const question = input.trim();
    if (!question || sending) {
      return;
    }

    setInput("");
    setSending(true);
    setMessages((items) => [
      ...items,
      { id: makeId(), role: "user", content: question },
    ]);

    try {
      const response = await fetch("/api/deepagent", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}) },
        body: JSON.stringify({ message: question, threadId }),
      });
      const payload = await response.json() as DeepAgentResponse;

      if (!response.ok) {
        if (response.status === 401) {
          setNeedsToken(true);
          setInput(question);
        }
        const detail = [payload.error, payload.hint].filter(Boolean).join("\n");
        throw new Error(detail || "DeepAgent 暂时不可用。");
      }

      setThreadId(payload.threadId ?? threadId);
      setNeedsToken(false);
      if (payload.threadId) window.sessionStorage.setItem("og-map-assistant-thread", payload.threadId);
      setMessages((items) => [
        ...items,
        {
          id: makeId(),
          role: "assistant",
          content: payload.answer || "DeepAgent 没有返回可显示内容。",
        },
      ]);
    } catch (error: unknown) {
      setMessages((items) => [
        ...items,
        {
          id: makeId(),
          role: "assistant",
          content: error instanceof Error ? error.message : "DeepAgent 暂时不可用。",
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <>
      {open ? (
        <section className="og-deepagent-panel" aria-label="DeepAgent 问答">
          <header>
            <span>
              <Sparkles size={15} />
              <strong>DeepAgent</strong>
            </span>
            <button type="button" aria-label="关闭 DeepAgent" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </header>
          <div className="og-deepagent-messages" ref={listRef} aria-live="polite">
            {messages.map((message) => (
              <div
                className={`og-deepagent-message is-${message.role} ${message.error ? "is-error" : ""}`}
                key={message.id}
              >
                {message.content}
              </div>
            ))}
            {sending ? (
              <div className="og-deepagent-message is-assistant is-loading">
                <LoaderCircle size={14} />
                <span>思考中</span>
              </div>
            ) : null}
          </div>
          {needsToken && (
            <label className="grid gap-1 px-3 py-2 text-sm">
              服务访问令牌
              <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)}
                className="rounded border px-2 py-1" />
            </label>
          )}
          <form className="og-deepagent-form" onSubmit={sendMessage}>
            <textarea
              aria-label="输入给 DeepAgent 的问题"
              value={input}
              rows={2}
              placeholder="问图层、数据或电网问题"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button type="submit" aria-label="发送问题" disabled={sending || !input.trim()}>
              {sending ? <LoaderCircle size={17} className="og-spin" /> : <Send size={17} />}
            </button>
          </form>
        </section>
      ) : null}
      <button
        className={`og-deepagent-toggle ${open ? "is-active" : ""}`}
        type="button"
        aria-label="打开 DeepAgent 问答"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      >
        <Bot size={18} />
        <span>智能体</span>
      </button>
    </>
  );
}
