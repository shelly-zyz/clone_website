"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Play, Search, SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { globeTopics, type WorkspaceTopic } from "@/lib/globe-topics";

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

export function WorkspaceSidebar({ topic, summary, leadingFilter, children, onSearch }: {
  topic: WorkspaceTopic;
  summary: string;
  leadingFilter?: ReactNode;
  children: ReactNode;
  onSearch?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sidebarId = useId();
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    mobileTrigger.current?.focus();
  };

  return (
    <>
      <div className="og-workspace-mobile-header">
        <button
          ref={mobileTrigger}
          type="button"
          aria-controls={sidebarId}
          aria-expanded={open}
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => closeButton.current?.focus());
          }}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>{globeTopics[topic].title}筛选</span>
        </button>
      </div>
      {open ? <button className="og-workspace-scrim" type="button" aria-label="关闭筛选" tabIndex={-1} onClick={close} /> : null}
      <aside
        id={sidebarId}
        className="og-workspace-sidebar"
        data-open={open}
        aria-label="地球数据筛选"
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) close();
        }}
      >
        <button ref={closeButton} className="og-workspace-close" type="button" aria-label="关闭筛选侧栏" onClick={close}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="og-workspace-sidebar-content" key={topic}>
          <header className="og-workspace-heading">
            <Link href="/" className="og-workspace-brand" aria-label="OpenGridWorks 首页" prefetch={false}>
              <Image src="/images/opengridworks/logo-dark.webp" alt="" width={24} height={24} />
              <span>OpenGridWorks</span>
            </Link>
            <h1>{globeTopics[topic].title}</h1>
            <p>{summary}</p>
          </header>
          <Link className="og-workspace-action" href="/" prefetch={false}>
            <Play size={13} fill="currentColor" aria-hidden="true" />
            播放开场
          </Link>
          {leadingFilter}
          {onSearch ? (
            <button className="og-workspace-action" type="button" onClick={() => {
              setOpen(false);
              onSearch();
            }}>
              <Search size={15} aria-hidden="true" />
              搜索电源项目或地点
            </button>
          ) : null}
          {children}
        </div>
        <Link href={{ pathname: "/visualization", query: { topic } }} className="og-workspace-visualization-link">
          <span>专题分析</span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </aside>
    </>
  );
}
