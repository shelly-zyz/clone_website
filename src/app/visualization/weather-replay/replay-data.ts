import type { WeatherReplay } from "@/lib/weather-replay/model";

export const utcClock = (iso: string) => iso.slice(11, 16);

/** Integrate consecutive rates in mm/h at the cadence declared by the archive. */
export function accumulateRain(replay: WeatherReplay) {
  const step = replay.metadata?.stepMinutes ?? 15;
  const [first, ...rest] = replay.rain;
  let previous = first;
  let totals = first.values.map<number | null>(value => value === null ? null : 0);
  const grids: (number | null)[][] = [totals];
  for (const frame of rest) {
    const consecutive = Date.parse(frame.time) - Date.parse(previous.time) === step * 60_000;
    totals = totals.map((total, cell) => {
      const before = previous.values[cell];
      const current = frame.values[cell];
      return !consecutive || total == null || before == null || current == null ? null : total + (before + current) * step / 120;
    });
    grids.push(totals);
    previous = frame;
  }
  return grids;
}

export function satelliteAt(replay: WeatherReplay, time: string) {
  const frame = replay.satellite.findLast(item => item.time <= time);
  return frame && Date.parse(time) - Date.parse(frame.time) < 60 * 60_000 ? frame : undefined;
}

export function stackFrameIndices(replay: WeatherReplay, index: number) {
  const frames = [index];
  const spacing = (replay.metadata?.stepMinutes ?? 30) * 60_000;
  let next = Date.parse(replay.rain[index].time) - spacing;
  for (let i = index - 1; i >= 0 && frames.length < 5; i--) {
    const time = Date.parse(replay.rain[i].time);
    if (time > next) continue;
    frames.unshift(i);
    next = time - spacing;
  }
  return frames;
}
