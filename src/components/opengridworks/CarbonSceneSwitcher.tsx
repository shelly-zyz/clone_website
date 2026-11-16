"use client";

import Image from "next/image";
import styles from "./SceneSwitcher.module.css";

const scenes = [
  { projection: "globe", title: "碳排放地球", image: "/images/opengridworks/globes/carbon.webp" },
  { projection: "map", title: "二维排放地图", image: "/images/opengridworks/carbon-atlas.webp" },
] as const;

type Projection = typeof scenes[number]["projection"];

export function CarbonSceneSwitcher({ projection, onChange }: {
  projection: Projection;
  onChange: (projection: Projection) => void;
}) {
  return (
    <nav aria-label="碳排放视图" className={`${styles.switcher} ${styles.carbon}`}>
      <div className={styles.cards}>
        {scenes.map(scene => (
          <button key={scene.projection} className={styles.card} type="button"
            aria-pressed={projection === scene.projection} data-planar={scene.projection === "map"}
            onClick={() => onChange(scene.projection)}>
            <Image src={scene.image} width={168} height={80} alt="" unoptimized />
            <span>{scene.title}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
