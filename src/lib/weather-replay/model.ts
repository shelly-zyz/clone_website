export type ReplayFrame = {
  time: string;
  url: string;
  values: (number | null)[];
};

export type ReplayBounds = { south: number; north: number; west: number; east: number };

export type WeatherReplay = {
  id: string;
  region: string;
  bounds: ReplayBounds;
  rows: number;
  cols: number;
  coastline: [number, number][][];
  satellite: ReplayFrame[];
  rain: ReplayFrame[];
};

export const demoReplayId = "us-southeast-2026-09-26";
