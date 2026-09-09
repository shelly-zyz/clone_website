import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { queryDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SourceProgressRow = {
  fileName: string;
  variable: string;
  periodStart: string;
  periodEnd: string;
  importStatus: string;
  expectedSizeBytes: string;
  expectedDays: number;
  importedFrames: number;
  updatedAt: string;
};

type QueueKey = "A" | "B";

const queueVariables: Record<QueueKey, string[]> = {
  A: ["sfcwind", "tas"],
  B: ["huss", "ps"],
};

const variableLabels: Record<string, string> = {
  rsds: "太阳辐射",
  sfcwind: "近地风速",
  tas: "地表温度",
  huss: "比湿",
  ps: "地表气压",
};

function percent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((value / total) * 1000) / 10));
}

function localSourceState(fileName: string, expectedSizeBytes: number) {
  const scratchDirectory = path.join(process.cwd(), ".scratch", "zenodo-climate");
  const completePath = path.join(scratchDirectory, fileName);
  const partialPath = `${completePath}.part`;
  const sourcePath = existsSync(completePath)
    ? completePath
    : existsSync(partialPath)
      ? partialPath
      : null;
  if (!sourcePath) {
    return { localBytes: 0, localUpdatedAt: null };
  }
  const stats = statSync(sourcePath);
  return {
    localBytes: Math.min(Number(stats.size), expectedSizeBytes),
    localUpdatedAt: stats.mtime.toISOString(),
  };
}

function buildQueue(key: QueueKey, sources: Array<SourceProgressRow & {
  localBytes: number;
  localUpdatedAt: string | null;
}>) {
  const variables = queueVariables[key];
  const queueSources = sources.filter((source) => variables.includes(source.variable));
  const incomplete = queueSources.filter((source) => source.importStatus !== "imported");
  const current = incomplete.find((source) => source.importStatus === "importing")
    ?? incomplete.find((source) => source.localBytes > 0)
    ?? incomplete[0]
    ?? null;
  const importedFrames = queueSources.reduce((sum, source) => sum + source.importedFrames, 0);
  const expectedFrames = queueSources.reduce((sum, source) => sum + source.expectedDays, 0);
  const completedFiles = queueSources.filter((source) => source.importStatus === "imported").length;

  let phase = completedFiles === queueSources.length ? "已完成" : "等待";
  let phasePercent = completedFiles === queueSources.length ? 100 : 0;
  if (current) {
    if (current.importedFrames >= current.expectedDays) {
      phase = "完整性校验";
      phasePercent = 100;
    } else if (current.importedFrames > 0) {
      phase = "写入数据库";
      phasePercent = percent(current.importedFrames, current.expectedDays);
    } else if (current.localBytes >= Number(current.expectedSizeBytes)) {
      phase = "MD5 校验与准备";
      phasePercent = 100;
    } else if (current.localBytes > 0) {
      phase = "下载源文件";
      phasePercent = percent(current.localBytes, Number(current.expectedSizeBytes));
    }
  }

  return {
    key,
    label: key === "A" ? "队列 A · 风速 / 温度" : "队列 B · 湿度 / 气压",
    completedFiles,
    totalFiles: queueSources.length,
    progressPercent: percent(importedFrames, expectedFrames),
    phase,
    phasePercent,
    current: current
      ? {
          fileName: current.fileName,
          variable: current.variable,
          variableLabel: variableLabels[current.variable] ?? current.variable,
          importedFrames: current.importedFrames,
          expectedDays: current.expectedDays,
          localBytes: current.localBytes,
          expectedSizeBytes: Number(current.expectedSizeBytes),
        }
      : null,
  };
}

export async function GET() {
  try {
    const [sourcesResult, sizeResult] = await Promise.all([
      queryDatabase<SourceProgressRow>(
        `
          SELECT
            s.file_name AS "fileName",
            s.variable,
            s.period_start::text AS "periodStart",
            s.period_end::text AS "periodEnd",
            s.import_status AS "importStatus",
            s.expected_size_bytes::text AS "expectedSizeBytes",
            (s.period_end - s.period_start + 1)::int AS "expectedDays",
            count(d.valid_date)::int AS "importedFrames",
            s.updated_at::text AS "updatedAt"
          FROM website_data.climate_projection_sources s
          LEFT JOIN website_data.climate_projection_daily d
            ON d.source_id = s.id
          GROUP BY s.id
          ORDER BY s.period_start, s.file_name
        `,
      ),
      queryDatabase<{ bytes: string; formatted: string }>(
        `
          SELECT
            pg_database_size(current_database())::text AS bytes,
            pg_size_pretty(pg_database_size(current_database())) AS formatted
        `,
      ),
    ]);

    const sources = sourcesResult.rows.map((source) => ({
      ...source,
      ...localSourceState(source.fileName, Number(source.expectedSizeBytes)),
    }));
    const totalFiles = sources.length;
    const completedFiles = sources.filter((source) => source.importStatus === "imported").length;
    const importedFrames = sources.reduce((sum, source) => sum + source.importedFrames, 0);
    const expectedFrames = sources.reduce((sum, source) => sum + source.expectedDays, 0);
    return NextResponse.json({
      ok: true,
      status: completedFiles === totalFiles ? "completed" : "running",
      progressPercent: percent(importedFrames, expectedFrames),
      completedFiles,
      totalFiles,
      importedFrames,
      expectedFrames,
      database: {
        bytes: Number(sizeResult.rows[0]?.bytes ?? 0),
        formatted: sizeResult.rows[0]?.formatted ?? "未知",
      },
      queues: [
        buildQueue("A", sources),
        buildQueue("B", sources),
      ],
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Import progress request failed.", error);
    return NextResponse.json(
      {
        ok: false,
        error: "暂时无法读取导入进度。",
      },
      { status: 503 },
    );
  }
}
