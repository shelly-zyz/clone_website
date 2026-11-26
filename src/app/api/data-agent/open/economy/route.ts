import { z } from "zod";
import { datasets } from "@/lib/data-agent/contracts";
import { dataAgentErrorResponse } from "@/lib/data-agent/http.server";
import { openAnnualResponse } from "@/lib/data-agent/open-annual.server";
import { queryData } from "@/lib/data-agent/query.server";

export const runtime = "nodejs";

const filters = z.strictObject({
  economy_code: z.string().regex(/^[A-Z0-9]{3}$/),
  metric: z.enum(["gdp", "population"]),
  year: z.coerce.number().int().min(2015).max(2024).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});
const metrics = {
  gdp: {
    code: "wdi_gdp_current_usd", indicator: "NY.GDP.MKTP.CD",
    providers: "各经济体官方统计机构及中央银行、OECD 国民账户数据、世界银行估算",
  },
  population: {
    code: "wdi_population_total", indicator: "SP.POP.TOTL",
    providers: "联合国人口司及统计司、各国统计机构、欧盟统计局",
  },
} as const;

export async function GET(request: Request) {
  const input = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) return Response.json({ error: "请指定三位 economy_code 和 gdp 或 population。可传 2015–2024 年及 json 或 csv 格式。" }, { status: 400 });
  const { economy_code, metric, year, format } = input.data;
  const { code, indicator, providers } = metrics[metric];
  try {
    const result = await queryData({
      topic: "economy", dataset_id: datasets.economy, metric_code: code, economy_code, limit: 10,
      start_date: year ? `${year}-01-01` : undefined,
      end_date: year ? `${year}-12-31` : undefined,
    });
    const source = {
      attribution: `The World Bank: World Development Indicators: ${indicator}。原指标汇集${providers}。OpenGridWorks 按源经济体和年度整理。`,
      url: `https://data.worldbank.org/indicator/${indicator}`,
      license: "CC BY 4.0",
      license_url: "https://creativecommons.org/licenses/by/4.0/",
      terms_url: "https://www.worldbank.org/ext/en/legal/terms-conditions/datasets",
    };
    return openAnnualResponse({ result, entity: { column: "economy_code", code: economy_code }, source, metric, format });
  } catch (error) {
    return dataAgentErrorResponse(error);
  }
}
