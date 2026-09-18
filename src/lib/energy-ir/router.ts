import type { EnergyExecutionPlan, EnergyIR, EnergyTool } from "./schema";

const tools: Record<EnergyIR["metric"], EnergyTool> = {
  mapped_asset_count: "mapped-assets",
  mapped_asset_sources: "mapped-assets",
  dataset_quality: "dataset-catalog",
  layer_availability: "layer-catalog",
  gfs_run_time: "weather-manifest",
  prediction_readiness: "prediction-gate",
};

export function routeEnergyIR(ir: EnergyIR): EnergyExecutionPlan {
  return {
    planVersion: 1,
    tool: tools[ir.metric],
    action: ir.metric,
    parameters: {
      province: ir.entities.province,
      technology: ir.entities.technology,
      dataset: ir.entities.dataset,
      facility: ir.entities.facility,
      timeMode: ir.time.mode,
    },
    readOnly: true,
    sql: null,
    resultLimit: ir.metric === "mapped_asset_sources" ? 20 : 200,
  };
}
