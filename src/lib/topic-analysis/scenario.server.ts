import "server-only";

import archived from "../../../public/data/climate-vre/summary.json";
import { type ClimateVreSummary } from "@/lib/climate-vre";
import { publicUrlToDatabasePath } from "@/lib/database-data-path";
import { queryDatabase } from "@/lib/db";
import type { RenewableScenario } from "./history";

const path = "/data/climate-vre/summary.json";
const provinceNames: Record<string, string> = {
  "cn-ah": "安徽", "cn-bj": "北京", "cn-cq": "重庆", "cn-fj": "福建", "cn-gs": "甘肃",
  "cn-gd": "广东", "cn-gx": "广西", "cn-gz": "贵州", "cn-hi": "海南", "cn-he": "河北",
  "cn-hl": "黑龙江", "cn-ha": "河南", "cn-hb": "湖北", "cn-hn": "湖南", "cn-nm": "内蒙古",
  "cn-js": "江苏", "cn-jx": "江西", "cn-jl": "吉林", "cn-ln": "辽宁", "cn-nx": "宁夏",
  "cn-qh": "青海", "cn-sn": "陕西", "cn-sd": "山东", "cn-sh": "上海", "cn-sx": "山西",
  "cn-sc": "四川", "cn-tj": "天津", "cn-xz": "西藏", "cn-xj": "新疆", "cn-yn": "云南", "cn-zj": "浙江",
};
type ScenarioSource = Pick<ClimateVreSummary, "generatedAt" | "gcm" | "scenario"> & {
  annual: Array<Omit<ClimateVreSummary["annual"][number], "technology"> & { technology: string }>;
};

function projectScenario(source: ScenarioSource, origin: RenewableScenario["origin"]): RenewableScenario {
  const regions = new Map<string, string>();
  const rows = source.annual.flatMap<RenewableScenario["rows"][number]>(row => {
    if (row.technology !== "wind" && row.technology !== "solar") return [];
    regions.set(row.regionId, provinceNames[row.regionId] ?? row.regionLabel);
    const months = new Map(row.monthlyMeans.map(item => [item.month, item.mean]));
    return [{
      region: row.regionId, technology: row.technology, year: row.year, factor: row.mean, generation: row.annualGenerationGwh,
      monthly: Array.from({ length: 12 }, (_, index) => months.get(index + 1) ?? null),
    }];
  });
  return {
    origin, generatedAt: source.generatedAt, gcm: source.gcm, scenario: source.scenario,
    regions: Array.from(regions, ([id, label]) => ({ id, label })),
    rows,
  };
}

export function archivedRenewableScenario() {
  return projectScenario(archived, "archive");
}

export async function readRenewableScenario(): Promise<RenewableScenario> {
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const { rows } = await queryDatabase<{ payload: ScenarioSource }>(
        "SELECT payload FROM website_data.json_documents WHERE path = $1",
        [publicUrlToDatabasePath(path)],
      );
      if (rows[0]?.payload?.annual?.length) {
        const scenario = projectScenario(rows[0].payload, "database");
        if (scenario.rows.length) return scenario;
      }
    } catch {
      console.warn("Published renewable scenario is unavailable.");
    }
  }
  return archivedRenewableScenario();
}
