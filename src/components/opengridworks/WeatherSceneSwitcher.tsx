"use client";

import { replayViewOrder, replayViews, type WeatherScene } from "@/lib/weather-replay/views";
import styles from "./PageSwitcher.module.css";

const scenes = ["globe", ...replayViewOrder] as const;
const title = (scene: WeatherScene) => scene === "globe" ? "气象地球" : replayViews[scene].title;

export function WeatherSceneSwitcher({ scene, onChange }: { scene: WeatherScene; onChange: (scene: WeatherScene) => void }) {
  const index = scenes.indexOf(scene);
  const previous = scenes[(index + scenes.length - 1) % scenes.length];
  const next = scenes[(index + 1) % scenes.length];

  return (
    <nav aria-label="气象可视化样式" className={styles.bar} onKeyDown={event => {
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
