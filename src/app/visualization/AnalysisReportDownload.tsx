"use client";

import { ChevronDown, Download, Printer } from "lucide-react";
import { useRef, useState } from "react";
import type { TopicReport } from "./analysis-report";
import styles from "./page.module.css";

type ReportFormat = "html" | "print";

export function AnalysisReportDownload({ report, topic, view, pending }: {
  report: TopicReport; topic: string; view: string; pending: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(format: ReportFormat) {
    if (busy || pending) return;
    const workbench = menu.current?.closest("section");
    const selections = Array.from(workbench?.querySelectorAll("select") ?? []).flatMap(select => {
      const label = select.labels?.[0]?.textContent?.trim();
      const value = select.selectedOptions[0]?.textContent?.trim();
      return label && value ? [{ label, value }] : [];
    });
    const generated = new Date().toISOString().slice(0, 10);
    setBusy(true);
    setError("");
    try {
      const { buildTopicReport } = await import("./analysis-report");
      const markup = await buildTopicReport({ ...report, context: [
        ...report.context, ...selections, { label: "报告生成日期（UTC）", value: generated },
      ] });
      const href = URL.createObjectURL(new Blob([markup], { type: "text/html;charset=utf-8" }));
      if (format === "html") {
        const link = document.createElement("a");
        link.href = href;
        link.download = `OpenGridWorks-${topic}-${view}-${generated}.html`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      } else {
        const frame = document.createElement("iframe");
        frame.title = "专题分析报告打印预览";
        frame.className = styles.reportPrintFrame;
        const release = () => { frame.remove(); URL.revokeObjectURL(href); };
        frame.onload = () => {
          const view = frame.contentWindow;
          if (!view) { release(); return; }
          view.addEventListener("afterprint", release, { once: true });
          try { view.print(); }
          catch { release(); setError("无法打开打印窗口，可下载 HTML 后从浏览器打印。"); }
        };
        frame.src = href;
        document.body.appendChild(frame);
        window.setTimeout(release, 180_000);
      }
      if (menu.current) menu.current.open = false;
    } catch {
      setError("报告暂时无法生成，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.reportExport}>
    <details className={styles.topicSwitcher} ref={menu}>
      <summary className={styles.downloadReport}>
        <Download size={15} aria-hidden />{busy ? "生成报告中" : "下载报告"}<ChevronDown size={14} aria-hidden />
      </summary>
      <div className={styles.reportMenu}>
        <button type="button" disabled={busy || pending} onClick={() => void run("html")}><Download size={15} aria-hidden />下载 HTML</button>
        <button type="button" disabled={busy || pending} onClick={() => void run("print")}><Printer size={15} aria-hidden />打印 / 保存 PDF</button>
        {pending && <p role="status">正在读取当前筛选的数据。</p>}
      </div>
    </details>
    {error && <p role="alert">{error}</p>}
  </div>;
}
