"use client";

import styles from "./PageSwitcher.module.css";

const scenes = [
  { projection: "globe", title: "碳排放地球" },
  { projection: "map", title: "二维排放地图" },
] as const;

type Projection = typeof scenes[number]["projection"];

export function CarbonSceneSwitcher({ projection, onChange }: {
  projection: Projection;
  onChange: (projection: Projection) => void;
}) {
  return (
    <nav aria-label="碳排放视图" className={styles.bar}>
      {scenes.map(scene => (
        <button key={scene.projection} type="button" aria-pressed={projection === scene.projection}
          onClick={() => onChange(scene.projection)}>
          {scene.title}
        </button>
      ))}
    </nav>
  );
}
