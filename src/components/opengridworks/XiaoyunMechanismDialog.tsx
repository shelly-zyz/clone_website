"use client";

import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Mechanism } from "@/lib/xiaoyun/anatomy";
import { mountMechanism, type MechanismControls } from "./xiaoyun-mechanism-scene";
import styles from "./XiaoyunMechanismDialog.module.css";

export function XiaoyunMechanismDialog({ mechanism, onClose }: { mechanism: Mechanism; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controls = useRef<MechanismControls | null>(null);
  const [step, setStep] = useState(0);
  const [noWebGl, setNoWebGl] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    try {
      controls.current = mountMechanism(element, mechanism.parts.map(part => part.shape));
    } catch {
      const frame = requestAnimationFrame(() => setNoWebGl(true));
      return () => cancelAnimationFrame(frame);
    }
    const lost = () => {
      controls.current?.dispose();
      controls.current = null;
      setNoWebGl(true);
    };
    element.addEventListener("webglcontextlost", lost);
    return () => {
      element.removeEventListener("webglcontextlost", lost);
      controls.current?.dispose();
      controls.current = null;
    };
  }, [mechanism]);

  useEffect(() => { controls.current?.focus(step); }, [step]);

  const current = mechanism.parts[step];
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => {
      event.preventDefault();
      onClose();
    }}>
      <header className={styles.header}>
        <h2 id={titleId}>{mechanism.title}</h2>
        <button aria-label="关闭立体示意" type="button" onClick={onClose}><X size={21} /></button>
      </header>
      <p className={styles.introduction}>{mechanism.introduction}</p>
      {!noWebGl && (
        <div className={styles.viewer}>
          <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
          <div className={styles.camera}>
            <button type="button" aria-label="向左旋转模型" onClick={() => controls.current?.rotate(-1)}><ChevronLeft size={18} /></button>
            <button type="button" aria-label="重置模型视角" onClick={() => controls.current?.reset()}><RotateCcw size={15} /></button>
            <button type="button" aria-label="向右旋转模型" onClick={() => controls.current?.rotate(1)}><ChevronRight size={18} /></button>
          </div>
          <p className={styles.hint}>拖动旋转 · 滚动缩放</p>
        </div>
      )}
      {noWebGl && <p className={styles.introduction} role="status">此设备暂无法显示立体模型，可按部件查看说明。</p>}
      <ol className={styles.parts} aria-label="工作过程">
        {mechanism.parts.map((part, index) => (
          <li key={index}>
            <button type="button" aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}>
              <span>{index + 1}</span> {part.name}
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.explanation} aria-live="polite">
        <h3>{current.name}</h3>
        <p>{current.explanation}</p>
      </div>
      <p className={styles.takeaway}>{mechanism.takeaway}</p>
    </dialog>
  );
}
