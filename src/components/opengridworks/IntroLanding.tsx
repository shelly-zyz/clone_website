"use client";

import { ArrowUpRight, Pause, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { globeTopicOrder, globeTopics, workspaceHref, type WorkspaceTopic } from "@/lib/globe-topics";
import { analysisHref, analysisTopics } from "@/lib/topic-analysis/catalog";
import { BrandLogo } from "./BrandLogo";
import type { IntroScene } from "./intro-particles";
import styles from "./IntroLanding.module.css";
import switcherStyles from "./PageSwitcher.module.css";

type SceneStatus = "loading" | "ready" | "static";

const topicDescriptions = {
  power: "电源与发电",
  weather: "风场与回放",
  carbon: "排放热点",
  economy: "规模与增长",
} satisfies Record<WorkspaceTopic, string>;

const recommendedTopics = ["power", "carbon"] as const;

export function IntroLanding() {
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [paused, setPaused] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<IntroScene | null>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    let generation = 0;
    let stopLoading: number | undefined;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function disposeScene() {
      generation += 1;
      window.clearTimeout(stopLoading);
      scene.current?.dispose();
      scene.current = null;
    }

    function fallback() {
      disposeScene();
      setStatus("static");
    }

    function prepare() {
      if (motion.matches) {
        fallback();
        return;
      }
      if (scene.current) return;
      const attempt = ++generation;
      setStatus("loading");
      stopLoading = window.setTimeout(fallback, 5000);
      void import("./intro-particles").then(({ createIntroScene }) => {
        if (generation !== attempt || !canvas.current) return;
        scene.current = createIntroScene(canvas.current, pausedRef.current, () => {
          window.clearTimeout(stopLoading);
          setStatus("ready");
        }, fallback);
      }).catch(() => {
        if (generation === attempt) fallback();
      });
    }

    prepare();
    motion.addEventListener("change", prepare);
    return () => {
      motion.removeEventListener("change", prepare);
      disposeScene();
    };
  }, []);

  function playPause() {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    scene.current?.pause(next);
  }

  return (
    <main className={styles.landing} aria-label="DataVista 开屏" data-scene={status}>
      <div className={styles.space} aria-hidden="true">
        <div className={styles.stars} />
        <div className={styles.poster}>
          <Image src="/intro/atlas-poster-overview.webp" alt="" width={820} height={820} preload unoptimized />
        </div>
        <canvas className={styles.canvas} ref={canvas} />
        <div className={styles.veil} />
      </div>

      <nav className={switcherStyles.bar} aria-label="平台导航">
        <Link href="#intro-globes">多维视图</Link>
        <Link href="/visualization">专题分析</Link>
      </nav>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <BrandLogo />
          </div>
          {status === "ready" && (
            <button className={styles.controlButton} type="button" aria-label={paused ? "继续开屏动画" : "暂停开屏动画"} onClick={playPause}>
              {paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
            </button>
          )}
        </header>

        <div className={styles.main}>
          <section className={styles.story} aria-labelledby="intro-title">
            <div className={styles.storyText}>
              <p className={styles.eyebrow}>地球数据观测</p>
              <h1 className={styles.title} id="intro-title">
                <span>看见地球</span>
                <span>的变化</span>
              </h1>
              <p className={styles.description}>从电力、气象、碳排放和经济四个视角，探索真实数据在地球上的分布与变化。</p>
            </div>
            <div>
              <Link className={styles.primary} href={workspaceHref("power")}>
                进入平台 <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </section>

          <aside className={styles.recommended} aria-label="相关专题分析">
            <div className={styles.cards}>
              {recommendedTopics.map((view, index) => {
                const topic = analysisTopics[view];
                return (
                  <Link key={view} href={analysisHref(view)} className={styles.card} data-lead={index === 0 ? "" : undefined}>
                    <Image
                      src={`/images/opengridworks/globes/${topic.globe}.webp`}
                      width={240} height={240} alt="" unoptimized
                    />
                    <div>
                      <strong>{topic.label}</strong>
                      <span>{topic.title}</span>
                    </div>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </aside>
        </div>

        <footer className={styles.footer}>
          <nav className={styles.globeLinks} id="intro-globes" aria-label="地球工作区">
            {globeTopicOrder.map(topic => (
              <Link className={styles.globeLink} key={topic} href={workspaceHref(topic)}>
                <Image src={`/images/opengridworks/globes/${topic}.webp`} alt="" width={240} height={240} unoptimized />
                <span>
                  <strong>{globeTopics[topic].label}</strong>
                  <span>{topicDescriptions[topic]}</span>
                </span>
                <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            ))}
          </nav>
          <p className={styles.credits}>NASA · Blue Marble / VIIRS 2012</p>
        </footer>
      </div>
    </main>
  );
}
