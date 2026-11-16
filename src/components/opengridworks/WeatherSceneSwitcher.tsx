"use client";

import Image from "next/image";
import { replayViewOrder, weatherSceneViews, type WeatherScene } from "@/lib/weather-replay/views";
import styles from "./SceneSwitcher.module.css";

const scenes = ["globe", ...replayViewOrder, "radar", "wind"] as const;
const title = (scene: WeatherScene) => scene === "globe" ? "气象地球" : weatherSceneViews[scene].title;
const image = (scene: WeatherScene) => scene === "globe"
  ? "/images/opengridworks/globes/weather.webp"
  : `/images/opengridworks/weather-replay/${scene}.webp`;

export function WeatherSceneSwitcher({ scene, onChange }: { scene: WeatherScene; onChange: (scene: WeatherScene) => void }) {
  const index = scenes.indexOf(scene);
  const previous = scenes[(index + scenes.length - 1) % scenes.length];
  const next = scenes[(index + 1) % scenes.length];

  return (
    <nav aria-label="气象可视化样式" className={`${styles.switcher} ${styles.weather}`} onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      onChange(event.key === "ArrowLeft" ? previous : next);
    }}>
      <div className={styles.cards}>
        {[previous, scene, next].map((item, position) => (
          <button key={position} type="button" className={styles.card} aria-pressed={scene === item}
            data-globe={item === "globe"} onClick={() => onChange(item)}>
            <Image src={image(item)} width={168} height={96} alt="" loading="eager" unoptimized />
            <span>{title(item)}</span>
          </button>
        ))}
      </div>
      <div className={styles.positions} role="group" aria-label="选择气象视图">
        {scenes.map(item => (
          <button key={item} type="button" aria-label={`切换到${title(item)}`}
            aria-pressed={scene === item} onClick={() => onChange(item)} />
        ))}
      </div>
    </nav>
  );
}
