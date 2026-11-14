"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getGlobeHandoff, noGlobeHandoff, subscribeGlobeHandoff } from "@/lib/globe-handoff";
import styles from "./GlobeHandoff.module.css";

export function GlobeHandoff() {
  const active = useSyncExternalStore(subscribeGlobeHandoff, getGlobeHandoff, noGlobeHandoff);
  const [last, setLast] = useState(active);
  // Retain the image while the overlay fades away.
  if (active && active !== last) setLast(active);
  useEffect(() => {
    if (active || !last) return;
    const timer = window.setTimeout(() => setLast(null), 240);
    return () => window.clearTimeout(timer);
  }, [active, last]);

  if (!last) return null;
  return (
    <div className={styles.overlay} data-active={Boolean(active)} aria-hidden="true">
      {/* The frame is a transient client-side WebGL capture, or a local poster. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-frame={Boolean(last.frame)} alt="" src={last.frame ?? `/images/opengridworks/globes/${last.topic}.webp`} />
    </div>
  );
}
