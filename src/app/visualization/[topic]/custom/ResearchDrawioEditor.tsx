"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./research.module.css";

export const localDrawioEditor = "http://127.0.0.1:6002/drawio/index.html?embed=1&proto=json&offline=1&lang=zh&spin=1";
const origin = new URL(localDrawioEditor).origin;

export function ResearchDrawioEditor({ drawing, onClose, onSave }: {
  drawing: string;
  onClose: () => void;
  onSave: (drawing: string) => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!modal.current?.open) modal.current?.showModal();
    const timeout = window.setTimeout(() => setSlow(true), 3500);
    function bridge(event: MessageEvent) {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || typeof event.data !== "string" || event.data.length > 2_000_000) return;
      let message: { event?: string; format?: string; xml?: unknown } | null;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.event === "init") {
        frame.current?.contentWindow?.postMessage(JSON.stringify({ action: "load", xml: drawing, noSaveBtn: 1, noExitBtn: 1 }), origin);
        setReady(true);
        window.clearTimeout(timeout);
      }
      if ((message?.event === "save" || message?.event === "export" && message.format === "xml") &&
        typeof message.xml === "string" && /^\s*(?:<\?xml[^?]*\?>\s*)?<(?:mxfile|mxGraphModel)\b/.test(message.xml)) onSave(message.xml);
    }
    window.addEventListener("message", bridge);
    return () => { window.clearTimeout(timeout); window.removeEventListener("message", bridge); };
  }, [drawing, onSave]);

  return <dialog ref={modal} className={styles.localEditor} aria-label="本机 Draw.io 编辑" onClose={onClose} onCancel={onClose}>
    <header><strong>本机 Draw.io 编辑</strong><div className={styles.commands}>
      <button type="button" disabled={!ready} onClick={() => {
        const editor = frame.current?.contentWindow;
        editor?.postMessage(JSON.stringify({ action: "resetEditor" }), origin);
        editor?.postMessage(JSON.stringify({ action: "export", format: "xml" }), origin);
      }}>下载编辑稿</button>
      <button type="button" onClick={onClose}>关闭</button>
    </div></header>
    {!ready && <p role="status">{slow ? "本机编辑器尚未响应。请确认 6002 端口已启动，或下载文件后直接打开。" : "正在加载本机编辑器…"}</p>}
    <iframe ref={frame} src={localDrawioEditor} title="Draw.io 可编辑图件" allowFullScreen />
  </dialog>;
}
