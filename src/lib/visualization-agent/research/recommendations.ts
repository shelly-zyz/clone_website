import { dataStructures, VisualizationError, type Engine, type FigureRecommendations } from "./contracts";
import { planFigure, type Evidence } from "./planner";
import { structureCharts } from "./structures";

export function recommendFigures(evidence: Evidence, engines: readonly Engine[]): FigureRecommendations {
  const datasets = evidence.map(item => item.profile);
  const choices = dataStructures.flatMap(structure => {
    const charts = structureCharts[structure].filter(kind => {
      try {
        planFigure({ task_id: "recommendation", configuration: { structure, kind, datasets: datasets.map(item => item.query) } }, evidence, engines);
        return true;
      } catch (error) {
        if (error instanceof VisualizationError) return false;
        throw error;
      }
    });
    return charts.length ? [{ structure, charts }] : [];
  });
  return { datasets, choices };
}
