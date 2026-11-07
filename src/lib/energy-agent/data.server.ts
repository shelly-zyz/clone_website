import "server-only";

import { createHash } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
import { chinaEnergyAssets } from "@/lib/china-map-data";
import { isEnergyTechnology, type EnergyDataRef, type EnergyRow, type EnergyTechnology } from "./contracts";

const limitation = "多来源地图设施记录，包含不同项目状态及可能重叠的记录。记录数和容量字段合计仅描述本样本，不能代表全国官方设施数量、在运装机或发电量。";
const rowSchema = z.object({
  technology: z.custom<EnergyTechnology>(isEnergyTechnology),
  records: z.number().int().nonnegative(),
  capacityMw: z.number().finite().nonnegative(),
  sources: z.array(z.string()),
});

const globalForEnergy = globalThis as typeof globalThis & { energyReadPool?: Pool };

function snapshotRows(): EnergyRow[] {
  const groups = new Map<EnergyTechnology, EnergyRow>();
  for (const asset of chinaEnergyAssets) {
    if (!isEnergyTechnology(asset.technology) || !["CN", "CHN"].includes(asset.countryCode)) continue;
    const row = groups.get(asset.technology) ?? {
      technology: asset.technology, records: 0, capacityMw: 0, sources: [],
    };
    row.records += 1;
    if (Number.isFinite(asset.capacityMw) && asset.capacityMw > 0) row.capacityMw += asset.capacityMw;
    if (!row.sources.includes(asset.source)) row.sources.push(asset.source);
    groups.set(asset.technology, row);
  }
  return [...groups.values()];
}

async function postgresRows(connectionString: string): Promise<EnergyRow[]> {
  if (!globalForEnergy.energyReadPool) {
    const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2500, idleTimeoutMillis: 15000 });
    pool.on("error", () => console.warn("Energy read pool lost an idle connection."));
    globalForEnergy.energyReadPool = pool;
  }
  const client = await globalForEnergy.energyReadPool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE green_agent_ro");
    await client.query("SET LOCAL statement_timeout = '3s'");
    const result = await client.query(`
      SELECT technology, records, capacity_mw AS "capacityMw", sources
      FROM derived.energy_asset_summary
      ORDER BY technology
    `);
    const rows = z.array(rowSchema).parse(result.rows);
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { releaseError = new Error("Energy read transaction could not roll back"); }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export async function queryEnergyData(technology: EnergyTechnology | "all") {
  const connectionString = process.env.ENERGY_DATABASE_URL?.trim();
  const databaseRows = connectionString ? await postgresRows(connectionString).catch(() => null) : null;
  const origin = databaseRows === null ? "repository-snapshot" : "postgres";
  const allRows = (databaseRows ?? snapshotRows())
    .map((row) => ({ ...row, capacityMw: Math.round(row.capacityMw * 100) / 100, sources: [...row.sources].sort() }))
    .sort((a, b) => a.technology.localeCompare(b.technology));
  const fingerprint = createHash("sha256").update(JSON.stringify(allRows)).digest("hex").slice(0, 16);
  const rows = allRows.filter((row) => technology === "all" || row.technology === technology);
  const ref: EnergyDataRef = {
    datasetId: "china-mapped-energy-assets", version: `${origin}:${fingerprint}`, origin,
    scope: "中国地图设施样本", technology,
    sources: [...new Set(rows.flatMap((row) => row.sources))].sort(), limitation,
  };
  return { ref, rows, databaseUnavailable: Boolean(connectionString) && databaseRows === null };
}

export const energyCatalog = {
  datasetId: "china-mapped-energy-assets", scope: "中国地图设施样本",
  dimensions: ["technology"], metrics: { records: "地图设施记录数（条）", capacity: "样本容量字段合计（MW）" },
  limitation,
};
