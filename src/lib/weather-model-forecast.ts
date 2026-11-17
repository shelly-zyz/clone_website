import { z } from "zod";

export const regionalWeatherModel = z.enum(["wrf", "climax"]);
export const weatherModel = z.enum(["gfs", ...regionalWeatherModel.options]);
export type WeatherModel = z.infer<typeof weatherModel>;
export const weatherRegionCode = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const weatherModelNames = { gfs: "GFS", wrf: "WRF", climax: "ClimaX" } as const;
export const weatherModelDatasets = {
  gfs: "meteo_gfs_forecast", wrf: "meteo_wrf_forecast", climax: "meteo_climax_forecast",
} as const;

const utcTime = z.iso.datetime();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const fileUri = z.url({ protocol: /^(https|s3)$/, normalize: true }).max(512).refine((uri) => {
  const { username, password, search, hash } = new URL(uri);
  return !username && !password && !search && !hash;
}, "来源地址不能包含凭据、查询或片段。");

export const weatherImportSchema = z.strictObject({
  model: regionalWeatherModel,
  model_version: z.string().trim().min(1).max(120),
  region_code: weatherRegionCode,
  region_name: z.string().trim().min(1).max(100),
  bounds: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90),
    z.number().min(-180).max(180), z.number().min(-90).max(90)])
    .refine(([west, south, east, north]) => west < east && south < north, "边界应为西、南、东、北。"),
  issue_time: utcTime.transform(time => new Date(time).toISOString()),
  source_uri: fileUri,
});

export const weatherFileOutputSchema = z.strictObject({
  file_sha256: sha256,
  file_metadata: z.strictObject({
    reader: z.enum(["netcdf4", "iris", "pygrib", "earthkit-data"]),
    variables: z.tuple([z.string(), z.string()]),
    unit: z.literal("m/s"),
    selected_cells: z.number().int().positive(),
    frame_count: z.number().int().min(1).max(120),
    first_valid_time: utcTime,
    last_valid_time: utcTime,
    cdo_crop: z.boolean(),
    grid_step: z.number().positive().nullable(),
  }),
  points: z.array(z.strictObject({
    valid_time: utcTime,
    value: z.number().nonnegative().nullable(),
    valid_cells: z.number().int().nonnegative(),
    total_cells: z.number().int().positive(),
  })).min(1).max(120),
});

export const weatherRegionSchema = z.object({
  code: weatherRegionCode, name: z.string(), models: z.array(regionalWeatherModel),
});
export type WeatherRegion = z.infer<typeof weatherRegionSchema>;
