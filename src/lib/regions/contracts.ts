export type RegionTheme = "power" | "weather" | "carbon";
export type RegionDataIdentity = "mapped-asset-sample" | "forecast" | "research-estimate";

export type RegionMetric = {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  status: "available" | "unknown";
};

export type RegionBreakdown = {
  id: string;
  label: string;
  value: number;
  unit: string;
  share: number | null;
};

export type RegionSummary = {
  schemaVersion: 1;
  request: {
    regionId: string;
    regionName: string;
    theme: RegionTheme;
    metric: string | null;
    time: string | null;
  };
  status: "available" | "unavailable";
  identity: RegionDataIdentity;
  title: string;
  updatedAt: string;
  metrics: RegionMetric[];
  breakdown: RegionBreakdown[];
  details: Array<{ label: string; value: string }>;
  coverage: { value: number | null; label: string };
  source: {
    name: string;
    timeRange: string;
    freshness: string;
    limitation: string;
  };
  missingReason: string | null;
};
