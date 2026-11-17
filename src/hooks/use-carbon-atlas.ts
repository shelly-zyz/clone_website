import { useEffect, useMemo, useState } from "react";
import { loadCarbonCatalog, loadCarbonFrame, type CarbonFrame, type CarbonCatalog } from "@/lib/carbon-earth";
import type { WorkspaceContext } from "@/lib/workspace-context";

export function useCarbonAtlas(enabled: boolean, selection: Pick<WorkspaceContext, "date" | "sector">) {
  const [catalog, setCatalog] = useState<{ manifest: CarbonCatalog | null; error: string | null }>();
  const [loaded, setLoaded] = useState<CarbonFrame | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const manifest = catalog?.manifest ?? null;
  const sector = selection.sector && manifest?.sectors.includes(selection.sector)
    ? selection.sector
    : manifest?.sectors.includes("Power") ? "Power" : manifest?.sectors[0] ?? "Power";
  const frames = useMemo(() => manifest?.frames.filter(item => item.sector === sector) ?? [], [manifest, sector]);
  const meta = selection.date ? frames.find(item => item.date === selection.date) : frames.at(-1);
  const date = meta?.date ?? selection.date ?? "";
  const key = sector + "/" + date;
  const frame = loaded?.date === date && loaded.sector === sector ? loaded : null;
  const unavailable = manifest && !meta && (selection.date ? "该部门没有此日期的发布网格。" : "该部门暂无发布网格。");
  const error = catalog?.error ?? (loadError?.key === key ? loadError.message : unavailable || null);
  const pending = !catalog || Boolean(meta && !frame && !error);
  const scaleMax = manifest?.scales[sector] ?? 1;

  useEffect(() => {
    if (!enabled || manifest) return;
    let relevant = true;
    void loadCarbonCatalog().then(data => {
      if (relevant) setCatalog({ manifest: data, error: null });
    }).catch(() => {
      if (relevant) setCatalog({ manifest: null, error: "排放数据目录暂不可用。" });
    });
    return () => { relevant = false; };
  }, [enabled, manifest, attempt]);

  useEffect(() => {
    if (!enabled || !meta || frame) return;
    const controller = new AbortController();
    void loadCarbonFrame(meta, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setLoaded(data);
      setLoadError(null);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError({ key, message: "此日期的排放网格暂不可用。" });
    });
    return () => controller.abort();
  }, [enabled, meta, frame, key, attempt]);

  return {
    manifest, sector, frames, date, frame, previousFrame: loaded, error, pending, scaleMax,
    retry: () => {
      setLoadError(null);
      if (!manifest) setCatalog(undefined);
      setAttempt(value => value + 1);
    },
  };
}
