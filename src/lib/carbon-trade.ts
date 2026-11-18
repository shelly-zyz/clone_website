export type TradeDirection = "both" | "in" | "out";
export type TradeFlow = [exporter: string, importer: string, mt: number];
export type Footprint = [year: number, production: number, consumption: number];

export type TradeCatalog = {
  edition: string;
  revision: string;
  years: number[];
  footprints: Record<string, Footprint[]>;
};

export const tradeSources = {
  trade: "https://data-explorer.oecd.org/vis?df[ag]=OECD.STI.PIE&df[id]=DSD_ICIO_GHG_TRADE_2025@DF_ICIO_GHG_TRADE_2025&df[vs]=1.0",
  footprint: "https://data-explorer.oecd.org/vis?df[ag]=OECD.STI.PIE&df[id]=DSD_ICIO_GHG_MAIN_2025@DF_ICIO_GHG_MAIN_2025&df[vs]=1.0",
};

export const tradeRegions = [
  { label: "亚洲", color: "#51caff", members: "ARE BGD BRN CHN HKG IDN IND ISR JOR JPN KAZ KHM KOR LAO MMR MYS PAK PHL SAU SGP THA TUR TWN VNM" },
  { label: "大洋洲", color: "#61dbb3", members: "AUS NZL" },
  { label: "北美洲", color: "#aa9bff", members: "CAN CRI MEX USA" },
  { label: "南美洲", color: "#f7bc70", members: "ARG BRA CHL COL PER" },
  { label: "欧洲", color: "#708cff", members: "AUT BEL BGR BLR CHE CYP CZE DEU DNK ESP EST FIN FRA GBR GRC HRV HUN IRL ISL ITA LTU LUX LVA MLT NLD NOR POL PRT ROU RUS SVK SVN SWE UKR" },
  { label: "非洲", color: "#49dbca", members: "AGO CIV CMR COD EGY MAR NGA SEN STP TUN ZAF" },
  { label: "其他地区", color: "#da83e0", members: "WXD" },
];

const territoryCodes = "AGO:AO ARE:AE ARG:AR AUS:AU AUT:AT BEL:BE BGD:BD BGR:BG BLR:BY BRA:BR BRN:BN CAN:CA CHE:CH CHL:CL CHN:CN CIV:CI CMR:CM COD:CD COL:CO CRI:CR CYP:CY CZE:CZ DEU:DE DNK:DK EGY:EG ESP:ES EST:EE FIN:FI FRA:FR GBR:GB GRC:GR HKG:HK HRV:HR HUN:HU IDN:ID IND:IN IRL:IE ISL:IS ISR:IL ITA:IT JOR:JO JPN:JP KAZ:KZ KHM:KH KOR:KR LAO:LA LTU:LT LUX:LU LVA:LV MAR:MA MEX:MX MLT:MT MMR:MM MYS:MY NGA:NG NLD:NL NOR:NO NZL:NZ PAK:PK PER:PE PHL:PH POL:PL PRT:PT ROU:RO RUS:RU SAU:SA SEN:SN SGP:SG STP:ST SVK:SK SVN:SI SWE:SE THA:TH TUN:TN TUR:TR TWN:TW UKR:UA USA:US VNM:VN ZAF:ZA";
const labels = new Intl.DisplayNames("zh-CN", { type: "region" });
const names = new Map(territoryCodes.split(" ").map(pair => {
  const [id, territory] = pair.split(":");
  return [id, labels.of(territory) ?? id];
}));
names.set("HKG", "中国香港");
names.set("TWN", "中国台北");
names.set("WXD", "世界其他地区");
names.set("W", "全球");

export function economyName(code: string) {
  return names.get(code) ?? code;
}

export function tradePartners(flows: TradeFlow[], economy: string) {
  const partners = new Map<string, { code: string; in: number; out: number }>();
  for (const [exporter, importer, mt] of flows) {
    if (exporter !== economy && importer !== economy) continue;
    const isExport = exporter === economy;
    const code = isExport ? importer : exporter;
    const partner = partners.get(code) ?? { code, in: 0, out: 0 };
    partner[isExport ? "out" : "in"] += mt;
    partners.set(code, partner);
  }
  return [...partners.values()];
}
