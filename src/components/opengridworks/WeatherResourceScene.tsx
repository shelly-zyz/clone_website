"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useWorkspaceResource } from "@/hooks/use-workspace-resource";
import { findChinaProvince } from "@/lib/china-provinces";
import type { RenewableScenario } from "@/lib/topic-analysis/history";
import { analysisContextHref, type WorkspaceContext } from "@/lib/workspace-context";
import { ForecastVisualization } from "./ForecastVisualization";
import { YearFilter } from "./YearFilter";
import { ScenarioRanking } from "./ScenarioScene";
import { ScenarioProvinceGlobe } from "./ScenarioProvinceGlobe";
import { GlobeAnalysis } from "./GlobeLayout";
import { WorkspaceFilterSelect, WorkspaceSidebar } from "./WorkspaceSidebar";
import switcherStyles from "./PageSwitcher.module.css";
import styles from "./WeatherResourceScene.module.css";

const options = [
  { id: "wind", label: "风电" },
  { id: "solar", label: "光伏" },
] as const;
const percentage = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "%";

export function WeatherResourceScene({ context, navigation, scenes, onChange, onBack }: {
  context: WorkspaceContext;
  navigation: ReactNode;
  scenes: ReactNode;
  onChange: (context: WorkspaceContext) => void;
  onBack: () => void;
}) {
  const { data, pending } = useWorkspaceResource<RenewableScenario>("/api/topic-analysis?topic=renewables");
  const technology = context.technology ?? "wind";
  const available = (data?.rows ?? []).filter(row => row.technology === technology);
  const years = [...new Set(available.map(row => row.year))].sort((a, b) => a - b);
  const year = context.year && years.includes(context.year) ? context.year : years.includes(2050) ? 2050 : years.at(-1);
  const selectedId = context.region && data?.regions.some(item => item.id === context.region) ? context.region : "china";
  const names = new Map(data?.regions.map(({ id, label }) => [id, label]));
  const points = available.filter(row => row.year === year);
  const selected = points.find(row => row.region === selectedId);
  const regional = points.filter(row => row.region !== "china").sort((a, b) => b.factor - a.factor);
  const ranking = regional.slice(0, 6);
  if (selected && selectedId !== "china" && !ranking.includes(selected)) ranking[ranking.length - 1] = selected;
  const rows = ranking.map(row => ({ id: row.region, label: names.get(row.region) ?? row.region, value: row.factor * 100 }));
  const regions = regional.flatMap(row => {
    const province = findChinaProvince(row.region);
    return province ? [{ id: row.region, iso: province.iso, coordinates: province.center, value: row.factor }] : [];
  });

  return (
    <>
      <WorkspaceSidebar topic="weather" summary="风光资源情景" navigation={navigation} scenes={scenes}>
        <nav className={switcherStyles.bar} aria-label="风光资源情景">
          {options.map(({ id, label }) => <button key={id} type="button" aria-pressed={technology === id}
            onClick={() => onChange({ technology: id })}>{label}</button>)}
        </nav>
        <WorkspaceFilterSelect label="选区" value={selectedId} onChange={region => onChange({ region })}
          options={data?.regions.map(({ id, label }) => ({ value: id, label })) ?? [{ value: "china", label: "中国全国" }]} />
        <YearFilter years={years} year={year} label="情景年份" onChange={value => onChange({ year: value })} />
        <button className="og-workspace-action" type="button" onClick={onBack}><ArrowLeft size={16} /> 返回气象地球</button>
      </WorkspaceSidebar>
      <div className="og-globe-stage"><ScenarioProvinceGlobe regions={regions} selected={selectedId} onSelect={region => onChange({ region })} /></div>
      <GlobeAnalysis>
        <ScenarioRanking title={names.get(selectedId) ?? "中国全国"}
          subtitle={data ? `${data.gcm} / ${data.scenario}` : "风光资源"}
          label={pending ? "正在读取情景…" : data ? (technology === "wind" ? "年均风电容量因子" : "年均光伏容量因子") : "情景暂不可用"}
          value={selected ? percentage(selected.factor * 100) : "—"}
          rows={rows} selected={selectedId} onSelect={region => onChange({ region })} formatValue={percentage}>
          {selected?.monthly.some(value => value !== null) ? (
            <section className={styles.monthly} aria-label="月度容量因子">
              <h3>月度容量因子</h3>
              <ForecastVisualization topic="weather" observed label="月度容量因子" unit="%" formatValue={percentage}
                valueCeiling={100} samples={selected.monthly.map((value, index) => ({
                  date: String(index + 1), position: index / 11, value: value === null ? null : value * 100,
                  dateLabel: `${index + 1} 月`, tickLabel: `${index + 1} 月`,
                }))} />
            </section>
          ) : null}
          <p className={styles.source}>{data ? `${data.origin === "archive" ? "项目情景归档" : "已发布情景"} · ${data.generatedAt.slice(0, 10)}` : "容量因子按已发布情景计算。"}</p>
          <Link className={styles.link} href={analysisContextHref("renewables", { region: selectedId, year, technology })}>
            风光季节互补分析 <ArrowUpRight size={15} />
          </Link>
        </ScenarioRanking>
      </GlobeAnalysis>
    </>
  );
}
