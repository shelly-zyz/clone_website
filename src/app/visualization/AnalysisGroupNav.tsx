"use client";

import { Menu } from "@base-ui/react/menu";
import { ChartNoAxesCombined, ChevronDown, CloudSun, Factory, Zap } from "lucide-react";
import { useRef } from "react";
import { analysisGroups } from "@/lib/topic-analysis/catalog";
import { useAnalysisAnchor } from "./useAnalysisAnchor";
import styles from "./page.module.css";

const groupIcons = { energy: Zap, climate: CloudSun, emissions: Factory, economics: ChartNoAxesCombined };

export function AnalysisGroupNav() {
  const container = useRef<HTMLDivElement>(null);
  const anchor = useAnalysisAnchor();
  const activeGroup = analysisGroups.find(group => group.id === anchor);

  return (
    <div ref={container}>
      <Menu.Root modal={false}>
        <Menu.Trigger className={styles.browseLink}>
          浏览专题 <ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal container={container}>
          <Menu.Positioner className={styles.browsePositioner} align="start" sideOffset={6}>
            <Menu.Popup className={styles.browseMenu} aria-label="专题分类">
              {analysisGroups.map(group => {
                const Icon = groupIcons[group.id];
                return (
                  <Menu.LinkItem key={group.id} href={"#" + group.id} closeOnClick
                    aria-current={group.id === activeGroup?.id ? "location" : undefined}>
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                    {group.label}
                  </Menu.LinkItem>
                );
              })}
              {activeGroup && <Menu.LinkItem href="#topics" closeOnClick className={styles.browseReset}>全部专题</Menu.LinkItem>}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
