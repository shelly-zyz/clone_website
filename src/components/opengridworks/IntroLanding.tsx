"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Compass, Pause, Play, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./IntroLanding.module.css";

const filmUrl = "/intro/graced-night-v1.mp4";

const chapters = [
  { topic: "weather", label: "气象地球", english: "WEATHER", title: "追踪全球风场",
    description: "查看全球气温、风速与风向，沿着风场探索不同起报时刻的气象预报。" },
  { topic: "power", label: "电力地球", english: "POWER", title: "读懂电力的版图",
    description: "在地图上查找电源与电网设施，结合月度能源统计观察发电量和电源结构。" },
  { topic: "carbon", label: "碳排放地球", english: "CARBON", title: "观察碳排放的分布",
    description: "浏览 GRACED 日尺度排放估算，观察全球电力部门碳排放的空间分布及其变化。" },
] as const;

export function IntroLanding() {
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const film = useRef<HTMLVideoElement>(null);
  const pausedByUser = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  const chapter = step === null ? undefined : chapters[step];

  useEffect(() => {
    const video = film.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function syncPlayback() {
      if (!video) return;
      if (motion.matches) {
        if (video.hasAttribute("src")) {
          video.removeAttribute("src");
          video.load();
        }
        return;
      }
      if (document.hidden || pausedByUser.current) {
        video.pause();
        return;
      }
      if (!video.hasAttribute("src")) video.src = filmUrl;
      void video.play().catch(() => {});
    }

    motion.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();
    return () => {
      motion.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, []);

  useEffect(() => {
    if (step !== null) {
      heading.current?.focus({ preventScroll: true });
    } else if (restoreFocus.current) {
      startButton.current?.focus({ preventScroll: true });
    }
  }, [step]);

  function closeTour() {
    restoreFocus.current = true;
    setStep(null);
  }

  function toggleFilm() {
    const video = film.current;
    if (!video) return;
    pausedByUser.current = !video.paused;
    if (video.paused) {
      if (!video.hasAttribute("src")) video.src = filmUrl;
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  return (
    <main className={styles.landing} aria-label="OpenGridWorks 开屏"
      onKeyDown={event => {
        if (event.key === "Escape" && chapter) closeTour();
      }}>
      <div aria-hidden="true" className={styles.space}>
        <div className={styles.planet}>
          <video ref={film} muted loop playsInline preload="none" poster="/intro/graced-night-v1.webp"
            onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onEmptied={() => setPlaying(false)} />
        </div>
        <div className={styles.veil} />
      </div>

      <header className={styles.header}>
        <div className="flex items-center gap-2.5">
          <Image className={styles.logo} src="/images/opengridworks/logo-dark.webp" alt="" width={36} height={36} />
          <span className={styles.wordmark}>OpenGridWorks</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {chapter
            ? <button type="button" className={styles.headerAction} onClick={closeTour}><X size={15} aria-hidden="true" />退出导览</button>
            : <span className={styles.headerLabel}>地球数据观测</span>}
          <button type="button" className={`${styles.headerAction} ${styles.filmControl}`} onClick={toggleFilm}
            aria-label={playing ? "暂停开屏动画" : "播放开屏动画"}>
            {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {chapter && step !== null ? (
        <section className={styles.hero} aria-label="专题导览">
          <div className={styles.scene} key={chapter.topic}>
            <p className={styles.eyebrow}><span />{chapter.english}<span /></p>
            <p className={styles.chapterLabel}>{chapter.label}</p>
            <h1 ref={heading} tabIndex={-1} className={styles.title}>{chapter.title}</h1>
            <p className={styles.description}>{chapter.description}</p>
          </div>
          <div className={styles.tourNav}>
            <div className={styles.progress} role="group" aria-label="选择导览章节">
              {chapters.map((item, index) => (
                <button key={item.topic} type="button" className={styles.step} aria-current={index === step ? "step" : undefined}
                  aria-label={`第 ${index + 1} 幕 · ${item.label}`} onClick={() => setStep(index)}>
                  <span>{`0${index + 1}`}</span><span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className={styles.tourActions}>
              <button type="button" className={styles.textAction} disabled={step === 0} onClick={() => setStep(step - 1)}>
                <ArrowLeft size={17} aria-hidden="true" />上一幕
              </button>
              {step === chapters.length - 1
                ? <a className={styles.textAction} href={`/workspace?topic=${chapter.topic}`}>进入平台<ArrowUpRight size={17} aria-hidden="true" /></a>
                : <button type="button" className={styles.textAction} onClick={() => setStep(step + 1)}>下一幕<ArrowRight size={17} aria-hidden="true" /></button>}
            </div>
            {step !== chapters.length - 1 && (
              <a className={styles.skip} href={`/workspace?topic=${chapter.topic}`}>进入平台<ArrowUpRight size={14} aria-hidden="true" /></a>
            )}
          </div>
        </section>
      ) : (
        <section className={styles.hero} aria-label="平台入口">
          <div className={styles.scene}>
            <p className={styles.eyebrow}><span />EARTH OBSERVATORY<span /></p>
            <h1 className={styles.title}>看见地球的变化</h1>
            <p className={styles.description}>在同一张地球上，探索气象、电力与碳排放数据。</p>
          </div>
          <div className={styles.choices}>
            <button ref={startButton} type="button" className={styles.choice} onClick={() => setStep(0)}>
              <span className={styles.choiceIcon}><Play size={20} strokeWidth={1.55} aria-hidden="true" /></span>
              <span className={styles.choiceText}><strong>观看导览</strong><small>认识三个地球专题</small></span>
              <ArrowRight className={styles.choiceArrow} size={16} aria-hidden="true" />
            </button>
            <a className={`${styles.choice} ${styles.primary}`} href="/workspace">
              <span className={styles.choiceIcon}><Compass size={23} strokeWidth={1.5} aria-hidden="true" /></span>
              <span className={styles.choiceText}><strong>进入平台</strong><small>打开地球工作区</small></span>
              <ArrowUpRight className={styles.choiceArrow} size={16} aria-hidden="true" />
            </a>
          </div>
          <p className={styles.sample}>
            <span>GRACED POWER · 2025.08.15</span>
            <span>电力排放格点样本 · 区域汇集演示</span>
          </p>
        </section>
      )}

      <footer className={styles.footer}>
        <span className={styles.footerIndex}>NASA GIBS · VIIRS 2012</span>
        <ul className={styles.legend} aria-label="地球专题">
          {chapters.map(item => <li key={item.topic} data-topic={item.topic}><span />{item.label}</li>)}
        </ul>
        <span className={styles.footerIndex}>GRACED POWER · 2025.08.15</span>
      </footer>
    </main>
  );
}
