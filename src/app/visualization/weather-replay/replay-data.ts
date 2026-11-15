import type { WeatherReplay } from "@/lib/weather-replay/model";

export const utcClock = (iso: string) => iso.slice(11, 16);

/** Integrate consecutive published 15-minute rates in mm/h over each prefix of the replay window. */
export function accumulateRain(replay: WeatherReplay) {
  const [first, ...rest] = replay.rain;
  let previous = first;
  let totals = first.values.map<number | null>(value => value === null ? null : 0);
  const grids: (number | null)[][] = [totals];
  for (const frame of rest) {
    const consecutive = Date.parse(frame.time) - Date.parse(previous.time) === 15 * 60_000;
    totals = totals.map((total, cell) => {
      const before = previous.values[cell];
      const current = frame.values[cell];
      return !consecutive || total == null || before == null || current == null ? null : total + (before + current) / 8;
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
  let next = Date.parse(replay.rain[index].time) - 30 * 60_000;
  for (let i = index - 1; i >= 0 && frames.length < 5; i--) {
    const time = Date.parse(replay.rain[i].time);
    if (time > next) continue;
    frames.unshift(i);
    next = time - 30 * 60_000;
  }
  return frames;
}
