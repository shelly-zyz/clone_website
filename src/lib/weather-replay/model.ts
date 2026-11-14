export type ReplayFrame = {
  time: string;
  url: string;
  values: (number | null)[];
};

export type WeatherReplay = {
  id: string;
  region: string;
  bounds: { south: number; north: number; west: number; east: number };
  rows: number;
  cols: number;
  coastline: [number, number][][];
  satellite: ReplayFrame[];
  rain: ReplayFrame[];
};

export const demoReplayId = "us-southeast-2026-09-26";
