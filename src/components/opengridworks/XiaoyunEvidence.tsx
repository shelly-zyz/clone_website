"use client";

import { useEffect, useId, useRef } from "react";
import type { Evidence } from "@/lib/xiaoyun/assistant-artifacts";

export function XiaoyunEvidence({ items, active, onOpen, onClose, onDismiss }: {
  items: Evidence[]; active?: Evidence; onOpen: (item: Evidence) => void; onClose: () => void; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const id = active?.id;
  useEffect(() => {
    const element = dialog.current;
    if (id && element && !element.open) element.showModal();
    return () => element?.close();
  }, [id]);

  return (
    <>
      {items.length > 0 && (
        <aside aria-label="审核证据" className="fixed bottom-4 left-4 z-[2450] max-h-[34svh] w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-900 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">审核证据</h2>
            <button type="button" onClick={onDismiss} className="rounded px-2 py-1 hover:bg-slate-100">收起</button>
          </div>
          <ol className="space-y-1">
            {items.map((item, index) => <li key={item.id}>
              <button type="button" onClick={() => onOpen(item)} className="w-full rounded px-2 py-2 text-left hover:bg-slate-100">
                <span className="block font-medium">[{index + 1}] {item.title}</span>
                <span className="block text-slate-600">{item.locator}</span>
              </button>
            </li>)}
          </ol>
        </aside>
      )}
      {active && <dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose(); }}
        className="m-auto max-h-[90svh] w-[min(42rem,calc(100vw-2rem))] overflow-auto rounded-lg bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/55">
        <div className="flex items-start justify-between gap-3">
          <h2 id={title} className="text-lg font-semibold">{active.title}</h2>
          <button type="button" onClick={onClose} className="shrink-0 rounded bg-slate-100 px-2 py-1">关闭证据</button>
        </div>
        <p className="mt-2 text-sm text-slate-600">{active.locator} · 版本 {active.version}</p>
        <blockquote className="my-4 whitespace-pre-wrap border-l-2 border-teal-600 pl-3 leading-relaxed">{active.passage}</blockquote>
        <a href={active.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-teal-800 underline">打开原文位置</a>
      </dialog>}
    </>
  );
}
