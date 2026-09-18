export const WEATHER_CACHE_MAX_AGE_MS = 75 * 60 * 1_000;
export const WEATHER_RUN_MAX_AGE_MS = 18 * 60 * 60 * 1_000;

export type WeatherFreshness = {
  cacheFresh: boolean;
  runFresh: boolean;
  stale: boolean;
  ageMinutes: number | null;
  runAgeHours: number | null;
};

export function evaluateWeatherFreshness(
  generatedAt: string | null | undefined,
  runTimeUtc: string | null | undefined,
  now = Date.now(),
): WeatherFreshness {
  const generated = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const run = runTimeUtc ? Date.parse(runTimeUtc) : Number.NaN;
  const generatedAge = Number.isFinite(generated) ? now - generated : null;
  const runAge = Number.isFinite(run) ? now - run : null;
  const cacheFresh = generatedAge !== null && generatedAge >= -60_000 && generatedAge <= WEATHER_CACHE_MAX_AGE_MS;
  const runFresh = runAge !== null && runAge >= -60 * 60 * 1_000 && runAge <= WEATHER_RUN_MAX_AGE_MS;
  return {
    cacheFresh,
    runFresh,
    stale: !cacheFresh || !runFresh,
    ageMinutes: generatedAge === null ? null : Number((generatedAge / 60_000).toFixed(1)),
    runAgeHours: runAge === null ? null : Number((runAge / 3_600_000).toFixed(1)),
  };
}
