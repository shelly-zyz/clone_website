"use client";

import Image from "next/image";
import { replayViewOrder, replayViews, type WeatherScene } from "@/lib/weather-replay/views";
import styles from "./WeatherSceneSwitcher.module.css";

const scenes = ["globe", ...replayViewOrder] as const;

export function WeatherSceneSwitcher({ scene, onChange }: { scene: WeatherScene; onChange: (scene: WeatherScene) => void }) {
  return (
    <nav aria-label="气象可视化样式" className={styles.switcher}>
      {scenes.map(item => (
        <button key={item} type="button" aria-pressed={scene === item} onClick={() => onChange(item)}>
          <Image
            src={item === "globe" ? "/images/opengridworks/globes/weather.webp" : `/images/opengridworks/weather-replay/${item}.webp`}
            width={132} height={75} alt="" loading="eager" unoptimized
          />
          <span>{item === "globe" ? "气象地球" : replayViews[item].title}</span>
        </button>
      ))}
    </nav>
  );
}
