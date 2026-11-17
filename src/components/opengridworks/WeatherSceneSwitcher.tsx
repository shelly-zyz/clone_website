"use client";

import { replayViewOrder, weatherSceneViews, type WeatherScene } from "@/lib/weather-replay/views";
import styles from "./SceneSwitcher.module.css";

const scenes = ["globe", ...replayViewOrder, "radar", "wind"] as const;
const title = (scene: WeatherScene) => scene === "globe" ? "气象地球" : weatherSceneViews[scene].title;

export function WeatherSceneSwitcher({ scene, onChange }: { scene: WeatherScene; onChange: (scene: WeatherScene) => void }) {
  const index = scenes.indexOf(scene);
  const previous = scenes[(index + scenes.length - 1) % scenes.length];
  const next = scenes[(index + 1) % scenes.length];

  return (
    <nav aria-label="气象可视化样式" className={`${styles.bar} ${styles.scene}`} onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const target = event.key === "ArrowLeft" ? previous : next;
      onChange(target);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${target}"]`)?.focus();
    }}>
      {scenes.map(item => (
        <button key={item} type="button" data-view={item} aria-pressed={scene === item}
          onClick={() => onChange(item)}>
          {title(item)}
        </button>
      ))}
    </nav>
  );
}
