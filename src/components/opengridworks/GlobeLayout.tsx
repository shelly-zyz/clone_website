"use client";

import { ChartNoAxesCombined, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";

type MobilePanel = "controls" | "analysis" | null;

const Slots = createContext<{
  mobilePanel: MobilePanel;
  setMobilePanel: (panel: MobilePanel) => void;
  revealAnalysis: () => void;
  controls: HTMLDivElement | null;
  setControls: (node: HTMLDivElement | null) => void;
  analysis: HTMLDivElement | null;
} | null>(null);

export function GlobeLayout({ children, ...props }: ComponentProps<"main">) {
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const [analysis, setAnalysis] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const panelId = useId();
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const closeMobileAnalysis = () => {
    setMobilePanel(null);
    mobileToggle.current?.focus();
  };

  const revealAnalysis = useCallback(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setMobilePanel("analysis");
    else setOpen(true);
  }, []);

  return (
    <Slots.Provider value={{ controls, setControls, analysis, mobilePanel, setMobilePanel, revealAnalysis }}>
      <main {...props}>
        {children}
        <div className="og-analysis-dock" data-open={open} data-mobile-open={mobilePanel === "analysis"}>
          <button type="button" className="og-analysis-toggle og-analysis-desktop-toggle" aria-controls={panelId}
            aria-expanded={open} aria-label={open ? "收起数据分析" : "展开数据分析"} onClick={() => setOpen(!open)}>
            {open ? <PanelRightClose size={17} aria-hidden="true" /> : <PanelRightOpen size={17} aria-hidden="true" />}
          </button>
          <button ref={mobileToggle} type="button" className="og-analysis-toggle og-analysis-mobile-toggle" aria-controls={panelId}
            aria-expanded={mobilePanel === "analysis"} onClick={() => setMobilePanel(mobilePanel === "analysis" ? null : "analysis")}>
            <ChartNoAxesCombined size={16} aria-hidden="true" /> 数据分析
          </button>
          <aside className="og-analysis-panel" id={panelId} aria-label="数据分析" onKeyDown={event => {
            if (event.key === "Escape" && mobilePanel === "analysis") closeMobileAnalysis();
          }}>
            <div ref={setAnalysis} className="og-analysis-content" />
            <button type="button" className="og-analysis-close" aria-label="关闭数据分析" onClick={closeMobileAnalysis}>
              <X size={17} aria-hidden="true" />
            </button>
          </aside>
        </div>
      </main>
    </Slots.Provider>
  );
}

export function useGlobeMobileControls() {
  const slots = useContext(Slots);
  return {
    open: slots?.mobilePanel === "controls",
    setOpen: (open: boolean) => slots?.setMobilePanel(open ? "controls" : null),
  };
}

export function GlobeControlOutlet() {
  const slots = useContext(Slots);
  return <div ref={slots?.setControls} className="og-scene-controls" />;
}

export function GlobeControls({ children }: { children: ReactNode }) {
  const target = useContext(Slots)?.controls;
  return target ? createPortal(children, target) : null;
}

export function useRevealGlobeAnalysis() {
  return useContext(Slots)?.revealAnalysis;
}

export function GlobeAnalysis({ children, selection }: { children: ReactNode; selection?: string }) {
  const slots = useContext(Slots);
  const revealAnalysis = slots?.revealAnalysis;
  useEffect(() => {
    if (selection) revealAnalysis?.();
  }, [selection, revealAnalysis]);

  return slots?.analysis ? createPortal(children, slots.analysis) : null;
}

export function ControlGroup({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="og-control-group" open={open}>
    <summary>{title}</summary>
    <div>{children}</div>
  </details>;
}
