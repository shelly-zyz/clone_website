import "server-only";

import { withBusinessAction } from "@/lib/agent-runtime/policy.server";
import { assertDataProject } from "@/lib/data-agent/state.server";
import { type ChartKind, type DatasetRequest, type Domain, VisualizationError } from "./contracts";
import { resolveDatasets, type ProjectAccess } from "./datasets.server";
import { describeNumbers, planFigure } from "./planner";
import { availableEngines } from "./render.server";

type DomainRequest = { datasets: DatasetRequest[]; target_unit?: string; target_frequency?: string };

function gap(detail: string): never { throw new VisualizationError("DATA_GAP", detail); }
function incompatible(detail: string): never { throw new VisualizationError("INCOMPATIBLE", detail); }

const priceMetric = /(?:clearing|settlement|market|spot|day_ahead|real_time|wholesale).*price|(?:电力|市场|现货|出清|结算|成交).*电价/i;
const carbonMass = /^(kg|t)(C|CO2)(\/(?:day|h|yr))?$/;

function carbonConversion(from: string, to: string) {
  if (from === to) return 1;
  const source = carbonMass.exec(from.replaceAll(" ", "").replaceAll("₂", "2"));
  const target = carbonMass.exec(to.replaceAll(" ", "").replaceAll("₂", "2"));
  if (!source || !target || source[3] !== target[3]) return incompatible("排放单位转换只支持同时间分母的 kg/t 碳质量与 CO₂ 质量。");
  const mass = (source[1] === "t" ? 1_000 : 1) / (target[1] === "t" ? 1_000 : 1);
  const gas = source[2] === target[2] ? 1 : target[2] === "CO2" ? 44 / 12 : 12 / 44;
  return mass * gas;
}

export async function researchDomainOperation(domain: Domain, operation: string, input: DomainRequest, access: ProjectAccess, signal: AbortSignal) {
  return withBusinessAction("visualization", domain + "." + operation, async () => {
    await assertDataProject(access.project_id, access.key);
    const evidence = await resolveDatasets(input.datasets, access, signal);
    if (evidence.some(item => item.data.domain !== domain)) incompatible("此工具仅接收所声明领域的数据。跨领域匹配请使用绘图计划。");
    const items = evidence.map(item => item.data);
    const identifiers = items.map(item => item.metric_id + " " + item.title);
    const unit = input.target_unit ?? items[0].unit;
    let factors = items.map(() => 1);
    let kind: ChartKind | undefined;
    switch (operation) {
      case "prepare_timeseries": case "prepare_emission_series": case "prepare_macro_series":
        if (items.some(item => item.dimensions.shape !== "time")) incompatible("时序准备需要具有有效时间的序列。");
        kind = "trend";
        break;
      case "compare_forecasts":
        if (!items.some(item => item.is_forecast)) gap("此工具需要已发布预测或项目内已完成任务。");
        if (items.length < 2 && !items.some(item => item.rows.some(row => row.actual != null))) gap("请提供第二条对比序列或含对照实值的回测。");
        kind = items.some(item => item.rows.some(row => row.actual != null)) ? "forecast-diagnostics" : "forecast";
        break;
      case "analyze_generation_mix":
        kind = "stack";
        break;
      case "analyze_market_prices": case "visualize_market_results":
        if (!identifiers.every(identifier => priceMetric.test(identifier))) gap("情报空白 · 缺少相同市场结算口径下的发布价格序列。");
        if (new Set(items.map(item => item.unit)).size !== 1 || new Set(items.map(item => item.aggregation_method)).size !== 1) {
          incompatible("市场价格必须有同一币种、单位和时间窗口。");
        }
        kind = operation === "analyze_market_prices" ? "box" : "trend-distribution";
        break;
      case "prepare_spatial_field":
        kind = "grid";
        break;
      case "analyze_precipitation":
        if (!identifiers.every(id => /rain|precipitat|降水/i.test(id) && !/precipitable|可降水/i.test(id))) gap("需要已发布的降水率或累计降水量。");
        kind = items.every(item => item.dimensions.shape === "grid") ? "grid" : "box";
        break;
      case "analyze_wind_field":
        if (!identifiers.every(id => /wind|风/.test(id))) gap("需要发布风速、风向分组或风场。");
        kind = items.every(item => item.dimensions.shape === "grid") ? "grid"
          : items.every(item => item.dimensions.shape === "category") ? "rose"
            : evidence.some(item => item.profile.sample_count - item.profile.missing < 4) ? "trend" : "box";
        break;
      case "harmonize_emission_units":
        factors = items.map(item => carbonConversion(item.unit, unit));
        break;
      case "analyze_sector_structure":
        if (!items.every(item => item.dimensions.shape === "category" && /sector|industry|行业|部门/i.test(item.metric_id + " " + item.title))) {
          gap("情报空白 · 缺少相同核算边界的行业类别排放发布值。");
        }
        kind = "rank";
        break;
      case "compare_scenarios": case "visualize_macro_scenarios":
        if (items.length < 2 || !items.every(item => item.data_type === "scenario") || new Set(items.map(item => item.series_id)).size < 2) {
          gap("情报空白 · 缺少两个以上带标识的已发布情景。");
        }
        if (items.some(item => item.metric_id !== items[0].metric_id || item.unit !== items[0].unit ||
          item.dimensions.time_grain !== items[0].dimensions.time_grain ||
          (item.region_label ?? item.rows[0].region_id) !== (items[0].region_label ?? items[0].rows[0].region_id))) {
          incompatible("情景对比需要同指标、单位、频率和地区。");
        }
        kind = "trend";
        break;
      case "visualize_emission_flow":
        kind = "flow";
        break;
      case "harmonize_frequency": {
        const grain = input.target_frequency ?? items[0].dimensions.time_grain;
        if (items.some(item => item.dimensions.time_grain !== grain)) gap("请提供具有所需频率和统计口径的正式发布序列。");
        break;
      }
      case "analyze_growth_contribution":
        if (!identifiers.every(id => /contribution|增长贡献/i.test(id))) gap("情报空白 · 当前经济快照没有已发布的增长分项贡献。");
        kind = "waterfall";
        break;
    }
    const chart = kind && planFigure({ task_id: "domain-profile", configuration: { kind, datasets: input.datasets } }, evidence, availableEngines());
    const statistics = items.map((item, index) => {
      const summary = describeNumbers(item.rows.flatMap(row => row.value === null ? [] : [row.value * factors[index]]));
      return { index, unit: operation === "harmonize_emission_units" ? unit : item.unit, factor: factors[index],
        missing: item.missing_mask.filter(Boolean).length, ...summary };
    });
    return { status: "ok", domain, operation, datasets: evidence.map(item => item.profile), statistics,
      recommended_chart: kind ?? null, validations: chart ? chart.plan.validations : ["核对项目、发布版本、单位和频率"],
      transformations: operation === "harmonize_emission_units" && factors.some(factor => factor !== 1)
        ? ["同时间分母；kg 与 t 按 1000 换算，C 与 CO₂ 按 44/12 的摩尔质量比换算。"]
        : chart ? chart.plan.transformations : [],
    };
  }, access.project_id);
}
