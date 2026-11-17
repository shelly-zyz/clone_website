"use client";

import { ChartNoAxesCombined, CloudSun, Factory, Zap } from "lucide-react";
import { analysisGroups } from "@/lib/topic-analysis/catalog";
import { useAnalysisAnchor } from "./useAnalysisAnchor";
import styles from "./page.module.css";

const groupIcons = { energy: Zap, climate: CloudSun, emissions: Factory, economics: ChartNoAxesCombined };

export function AnalysisGroupNav() {
  const anchor = useAnalysisAnchor();
  const activeGroup = analysisGroups.find(group => group.id === anchor) ?? analysisGroups[0];

  return (
    <nav className={styles.groupBar} aria-label="专题分类">
      <div>
        {analysisGroups.map(group => {
          const Icon = groupIcons[group.id];
          return (
            <a key={group.id} href={"#" + group.id} aria-current={group.id === activeGroup.id ? "location" : undefined}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {group.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
