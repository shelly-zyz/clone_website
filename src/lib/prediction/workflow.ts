import type { PredictionModelRegistry, PredictionStatus } from "./contracts";

export type PredictionWorkflowState = "complete" | "research" | "locked";

export type PredictionWorkflowStage = {
  title: string;
  detail: string;
  product: string;
  note: string;
  kind: "lines" | "bars" | "dual" | "matrix" | "network" | "fan";
  state: PredictionWorkflowState;
};

export function derivePredictionWorkflow(
  status: PredictionStatus | null,
  currentWeatherAvailable: boolean,
  registry: PredictionModelRegistry | null = null,
): PredictionWorkflowStage[] {
  const evidence = status?.researchEvidence;
  const realData = status?.realData?.status === "verified-research-only" ? status.realData : null;
  const tenMinute = evidence?.metrics.find((metric) => metric.horizonMinutes === 10);
  const rejected = evidence?.rejectedHorizonsMinutes.join("/");
  const hasObservedPower = status?.dataGates.observedPower === true;
  const hasHistoricalNwp = status?.dataGates.historicalNwp === true;
  const qualityGatePassed = status?.dataGates.temporalCoverage === true && status?.dataGates.sourceQuality === true;

  return [
    {
      title: "GFS 气象输入",
      detail: "起报时刻 · 有效时刻 · 风速场",
      product: currentWeatherAvailable ? "当前气象场就绪" : "气象输入锁定",
      note: currentWeatherAvailable ? "当前预报图层可读取 · 非历史训练档案" : "当前GFS图层不可用",
      kind: "lines",
      state: currentWeatherAvailable ? "complete" : "locked",
    },
    {
      title: "历史 NWP 档案",
      detail: "样本切片 · issue / valid 对齐",
      product: hasHistoricalNwp ? `${realData?.dataset.nwpPointRows?.toLocaleString() ?? ""}点历史NWP` : "历史样本库未接入",
      note: hasHistoricalNwp
        ? `${realData?.dataset.trainingPairRows?.toLocaleString() ?? ""}条配对 · issue / valid 已核验`
        : "缺历史NWP起报/有效时刻",
      kind: "bars",
      state: hasHistoricalNwp ? "complete" : "locked",
    },
    {
      title: "真实功率标签",
      detail: "风速与场站出力同步配对",
      product: hasObservedPower ? realData ? `${realData.dataset.observedRows?.toLocaleString() ?? ""}条真实SCADA` : "真实SCADA标签" : "功率标签未接入",
      note: realData
        ? `${realData.dataset.turbineCount ?? "?"}台机组 · ${realData.dataset.observedStartUtc?.slice(0, 10) ?? "未知"}起`
        : evidence ? `${(evidence.dataset.rawRows / 1_000_000).toFixed(2)}M行 · ${evidence.dataset.turbineCount}台机组` : "等待合法真实功率数据",
      kind: "dual",
      state: hasObservedPower ? "complete" : "locked",
    },
    {
      title: "约束与编码检查",
      detail: "容量 · 停机 · 限电 · 质量掩码",
      product: realData ? qualityGatePassed ? "质量门禁通过" : "质量缺口已隔离" : evidence ? "质量隔离矩阵" : "质量检查未运行",
      note: realData
        ? `最佳90天 ${(realData.quality.best90DayCompleteness == null ? 0 : realData.quality.best90DayCompleteness * 100).toFixed(2)}% · ${realData.quality.invalidHourlyWindows ?? 0}小时隔离`
        : evidence ? `${(evidence.dataset.usableRatio * 100).toFixed(1)}%聚合时刻可回测` : "等待真实功率标签",
      kind: "matrix",
      state: realData ? qualityGatePassed ? "complete" : "research" : evidence ? "complete" : "locked",
    },
    {
      title: "基线与 LightGBM",
      detail: "特征输入 · 模型比较 · 版本登记",
      product: tenMinute?.passesRollingGate ? "10分钟滚动候选" : evidence ? "未获稳定滚动增益" : "模型比较未运行",
      note: tenMinute
        ? `10min ${tenMinute.rollingWins ?? 1}/${tenMinute.rollingFolds ?? registry?.promotionGate.minimumFolds ?? 3}折胜 · 均值 ${tenMinute.meanRollingImprovementPct == null ? `${tenMinute.maeImprovementPct > 0 ? "+" : ""}${tenMinute.maeImprovementPct.toFixed(2)}%` : `${tenMinute.meanRollingImprovementPct > 0 ? "+" : ""}${tenMinute.meanRollingImprovementPct.toFixed(2)}%`}`
        : "等待可审计回测",
      kind: "network",
      state: evidence ? "research" : "locked",
    },
    {
      title: "确定性输出与回测",
      detail: "严格时间留出 · 误差回流 · 概率层锁定",
      product: evidence ? "分时效历史回测" : "回测尚未生成",
      note: evidence ? `${rejected || "各"}分钟未过滚动门禁 · 无P10/P50/P90` : "生产输出门禁锁定",
      kind: "fan",
      state: evidence ? "research" : "locked",
    },
  ];
}
