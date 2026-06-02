import type {
  DataCenterAsset,
  EnergyAsset,
  GridLine,
  Substation,
} from "@/types/opengridworks";
import chinaMapDataJson from "./china-map-data.generated.json";

type ChinaMapDataFile = {
  energyAssets: EnergyAsset[];
  dataCenters: DataCenterAsset[];
  gridLines: GridLine[];
  substations: Substation[];
};

const chinaMapData = chinaMapDataJson as unknown as ChinaMapDataFile;

export const chinaEnergyAssets = chinaMapData.energyAssets;
export const chinaDataCenters = chinaMapData.dataCenters;
export const chinaGridLines = chinaMapData.gridLines;
export const chinaSubstations = chinaMapData.substations;
