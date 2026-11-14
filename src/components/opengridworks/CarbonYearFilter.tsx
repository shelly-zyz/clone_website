"use client";

import type { CarbonManifestFrame } from "@/lib/carbon-earth";
import { YearFilter } from "./YearFilter";

export function CarbonYearFilter({ frames, date, onDate }: {
  frames: readonly CarbonManifestFrame[];
  date: string;
  onDate: (date: string) => void;
}) {
  const years = [...new Set(frames.map(frame => Number(frame.date.slice(0, 4))))].sort((a, b) => a - b);

  return (
    <YearFilter years={years} year={date ? Number(date.slice(0, 4)) : undefined} label="排放年份" onChange={year => {
      const sameDay = `${year}${date.slice(4)}`;
      const next = frames.find(frame => frame.date === sameDay)
        ?? frames.reduce<CarbonManifestFrame | undefined>((latest, frame) => (
          frame.date.startsWith(String(year)) && (!latest || frame.date > latest.date) ? frame : latest
        ), undefined);
      if (next) onDate(next.date);
    }} />
  );
}
