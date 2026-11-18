"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronDown, Play, Search, SlidersHorizontal } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { globeTopics, type WorkspaceTopic } from "@/lib/globe-topics";
import { rememberWorkspace } from "@/lib/workspace-context";
import { ControlGroup, GlobeControlOutlet, useGlobeMobileControls } from "./GlobeLayout";
import { BrandLogo } from "./BrandLogo";

export type WorkspaceFilterOption = { value: string; label: string; disabled?: boolean };

export function WorkspaceFilterSelect({ label, options, value, onChange }: {
  label: string;
  options: WorkspaceFilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selectId = useId();
  return (
    <div className="og-filter-field">
      <label htmlFor={selectId}>{label}</label>
      <span className="og-filter-select">
        <select id={selectId} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </div>
  );
}

export function WorkspaceSidebar({ topic, summary, navigation, scenes, leadingFilter, children, onSearch }: {
  topic: WorkspaceTopic;
  summary: string;
  navigation: ReactNode;
  scenes?: ReactNode;
  leadingFilter?: ReactNode;
  children: ReactNode;
  onSearch?: () => void;
}) {
  const { open, setOpen } = useGlobeMobileControls();
  const sidebarId = useId();
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    mobileTrigger.current?.focus();
  };

  return (
    <>
      <div className="og-workspace-mobile-header">
        <Link href="/" className="og-workspace-brand" aria-label="DataVista 首页" prefetch={false}>
          <BrandLogo />
        </Link>
        <button
          ref={mobileTrigger}
          type="button"
          aria-controls={sidebarId}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>操作</span>
        </button>
      </div>
      <aside
        id={sidebarId}
        className="og-workspace-sidebar"
        data-open={open}
        aria-label="地球数据筛选"
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) close();
        }}
      >
        <div className="og-sidebar-core">
          <Link href="/" className="og-workspace-brand" aria-label="DataVista 首页" prefetch={false}>
            <BrandLogo />
          </Link>
          {navigation}
        </div>
        <div className="og-workspace-sidebar-content" key={topic}>
          <header className="og-workspace-heading">
            <h1>{globeTopics[topic].title}</h1>
            {summary && <p>{summary}</p>}
          </header>
          {scenes}
          {leadingFilter}
          {onSearch && <button className="og-workspace-action" type="button" onClick={onSearch}>
            <Search size={15} aria-hidden="true" />
            搜索电源项目或地点
          </button>}
          {children}
          <GlobeControlOutlet />
          <ControlGroup title="辅助功能">
            <Link className="og-workspace-action" href="/" prefetch={false}>
              <Play size={13} fill="currentColor" aria-hidden="true" /> 播放开场
            </Link>
          </ControlGroup>
        </div>
        <Link href={{ pathname: "/visualization", query: { topic } }} className="og-workspace-visualization-link"
          onNavigate={() => rememberWorkspace(topic)}>
          <span>专题分析</span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </aside>
    </>
  );
}
