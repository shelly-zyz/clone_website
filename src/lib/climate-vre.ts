export type VreTechnology = "wind" | "solar";

export type ClimateVreRegion = {
  id: string;
  label: string;
  gridCount: number;
  fallbackAssignedGridCount: number;
  capacityMwByTechnology: Record<VreTechnology, number>;
};

export type ClimateVreManifest = {
  generatedAt: string;
  generatedBy: string;
  gcm: string;
  scenario: string;
  unit: "capacity_factor";
  powerUnit: "mw";
  energyUnit: "gwh";
  capacityBasis: string;
  capacityBasisLabel: string;
  timeRange: {
    start: string;
    end: string;
    hours: number;
  };
  source: {
    input: string;
    paper: string;
    zenodo: string;
    code: string;
  };
  technologies: { key: VreTechnology; label: string }[];
  years: number[];
  regions: ClimateVreRegion[];
  summaryPath: string;
  hourlyPathTemplate: string;
};

export type ClimateVreSummaryRow = {
  regionId: string;
  regionLabel: string;
  technology: VreTechnology;
  year: number;
  mean: number;
  capacityBasis: string;
  capacityBasisLabel: string;
  capacityMw: number;
  annualGenerationGwh: number;
  peakPowerMw: number;
  lowPowerMw: number;
  peak: {
    hourOfYear: number;
    value: number;
  };
  low: {
    hourOfYear: number;
    value: number;
  };
  monthlyMeans: { month: number; mean: number; generationGwh: number }[];
};

export type ClimateVreSummary = {
  generatedAt: string;
  gcm: string;
  scenario: string;
  unit: "capacity_factor";
  powerUnit: "mw";
  energyUnit: "gwh";
  capacityBasis: string;
  capacityBasisLabel: string;
  annual: ClimateVreSummaryRow[];
};

export type ClimateVreHourly = {
  gcm: string;
  scenario: string;
  regionId: string;
  regionLabel: string;
  technology: VreTechnology;
  unit: "capacity_factor";
  powerUnit: "mw";
  energyUnit: "gwh";
  capacityBasis: string;
  capacityBasisLabel: string;
  capacityMw: number;
  scale: number;
  year: number;
  hours: number;
  values: number[];
  stats: Omit<ClimateVreSummaryRow, "regionId" | "regionLabel" | "technology" | "year">;
};

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) {
      return null;
    }
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function loadClimateVreManifest() {
  return fetchJson<ClimateVreManifest>("/api/data/climate-vre?request=manifest");
}

export function loadClimateVreSummary(_path: string) {
  void _path;
  return fetchJson<ClimateVreSummary>("/api/data/climate-vre?request=summary");
}

export function loadClimateVreHourly(
  _template: string,
  regionId: string,
  year: number,
  technology: VreTechnology,
  gcm = "gfdl-esm4",
  scenario = "ssp126",
) {
  void _template;
  const path = `/api/data/climate-vre?request=hourly&gcm=${encodeURIComponent(gcm)}&scenario=${encodeURIComponent(scenario)}&regionId=${encodeURIComponent(regionId)}&year=${year}&technology=${technology}`;
  return fetchJson<ClimateVreHourly>(path);
}

export function capacityFactorPercent(value: number) {
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

export function generationLabel(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 GWh";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} TWh`;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} GWh`;
}

export function technologyLabel(technology: VreTechnology) {
  return technology === "wind" ? "风电" : "光伏";
}
