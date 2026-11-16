"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProvincePowerFrame } from "@/lib/china-power-statistics";
import type { MapCameraState } from "@/types/opengridworks";
import type { ChinaPowerGeography } from "./power-statistics-geometry";
import { createPowerStatisticsScene } from "./power-statistics-scene";
import styles from "./PowerStatisticsMap.module.css";

type Scene = ReturnType<typeof createPowerStatisticsScene>;
type Props = Parameters<typeof createPowerStatisticsScene>[2] & {
  frame: ProvincePowerFrame;
  selected?: string;
  initialCamera?: MapCameraState;
  focus?: { nonce: number; camera?: MapCameraState };
  screenshotRequest: number;
  onReady: () => void;
  onScreenshotComplete: (message: string) => void;
};

export function PowerStatisticsMap(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene | null>(null);
  const latest = useRef(props);
  const initialFocus = useRef(props.focus?.nonce);
  const lastScreenshot = useRef(props.screenshotRequest);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => { latest.current = props; }, [props]);

  useEffect(() => {
    if (!canvas.current) return;
    const element = canvas.current;
    const controller = new AbortController();
    void fetch("/data/china-power/provinces.geojson", { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("省级边界数据暂不可用");
        return response.json() as Promise<ChinaPowerGeography>;
      })
      .then(geo => {
        if (controller.signal.aborted) return;
        const current = latest.current;
        const map = createPowerStatisticsScene(element, geo, {
          onCamera: camera => latest.current.onCamera(camera),
          onHover: tooltip => latest.current.onHover(tooltip),
          onSelect: code => latest.current.onSelect(code),
        });
        scene.current = map;
        map.update(current.frame, current.selected);
        map.focus(current.focus && current.focus.nonce !== initialFocus.current ? current.focus.camera : current.initialCamera, false);
        setStatus("ready");
        requestAnimationFrame(() => {
          if (!controller.signal.aborted) latest.current.onReady();
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus("error");
        latest.current.onReady();
      });
    return () => {
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => { scene.current?.update(props.frame, props.selected); }, [props.frame, props.selected]);

  const focusNonce = props.focus?.nonce;
  useEffect(() => {
    if (focusNonce != null && focusNonce !== initialFocus.current) scene.current?.focus(latest.current.focus?.camera);
  }, [focusNonce]);

  useEffect(() => {
    if (!scene.current || props.screenshotRequest === lastScreenshot.current) return;
    lastScreenshot.current = props.screenshotRequest;
    const link = document.createElement("a");
    link.href = scene.current.screenshot();
    link.download = "opengridworks-power-map.png";
    link.click();
    latest.current.onScreenshotComplete("已导出透明背景的电力统计地图 PNG。");
  }, [props.screenshotRequest, status]);

  return (
    <section className={styles.viewport} aria-label="中国省级电力统计三维地图" data-map-ready={status === "ready"}>
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      {status !== "ready" ? (
        <p className={styles.status} role="status">
          {status === "loading" ? "正在加载中国省级边界…" : "当前浏览器无法绘制三维地图，可在筛选栏查看统计。"}
        </p>
      ) : (
        <>
          <div className={styles.controls} role="group" aria-label="电力地图缩放">
            <button type="button" aria-label="放大地图" onClick={() => scene.current?.zoom(1.25)}><Plus size={17} /></button>
            <button type="button" aria-label="缩小地图" onClick={() => scene.current?.zoom(.8)}><Minus size={17} /></button>
          </div>
          <span className={styles.insetLabel}>南海诸岛</span>
        </>
      )}
    </section>
  );
}
