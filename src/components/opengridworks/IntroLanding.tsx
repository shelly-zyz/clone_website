"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Compass, Play, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IntroGlobe } from "./IntroGlobe";
import styles from "./IntroLanding.module.css";

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
  const startButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  const chapter = step === null ? undefined : chapters[step];

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

  return (
    <main className={styles.landing} aria-label="OpenGridWorks 开屏"
      onKeyDown={event => {
        if (event.key === "Escape" && chapter) closeTour();
      }}>
      <div aria-hidden="true" className={styles.space}>
        <div className={styles.planet}>
          <IntroGlobe scene={chapter?.topic ?? "overview"} />
        </div>
        <div className={styles.veil} />
      </div>

      <header className={styles.header}>
        <div className="flex items-center gap-2.5">
          <Image className={styles.logo} src="/images/opengridworks/logo-dark.webp" alt="" width={36} height={36} />
          <span className={styles.wordmark}>OpenGridWorks</span>
        </div>
        {chapter
          ? <button type="button" className={styles.headerAction} onClick={closeTour}><X size={15} aria-hidden="true" />退出导览</button>
          : <span className={styles.headerLabel}>地球数据观测</span>}
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
                ? <Link className={styles.textAction} href={`/workspace?topic=${chapter.topic}`} prefetch={false}>进入平台<ArrowUpRight size={17} aria-hidden="true" /></Link>
                : <button type="button" className={styles.textAction} onClick={() => setStep(step + 1)}>下一幕<ArrowRight size={17} aria-hidden="true" /></button>}
            </div>
            {step !== chapters.length - 1 && (
              <Link className={styles.skip} href={`/workspace?topic=${chapter.topic}`} prefetch={false}>进入平台<ArrowUpRight size={14} aria-hidden="true" /></Link>
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
            <Link className={`${styles.choice} ${styles.primary}`} href="/workspace" prefetch={false}>
              <span className={styles.choiceIcon}><Compass size={23} strokeWidth={1.5} aria-hidden="true" /></span>
              <span className={styles.choiceText}><strong>进入平台</strong><small>打开地球工作区</small></span>
              <ArrowUpRight className={styles.choiceArrow} size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <span className={styles.footerIndex}>OPEN GRID WORKS</span>
        <ul className={styles.legend} aria-label="地球专题">
          {chapters.map(item => <li key={item.topic} data-topic={item.topic}><span />{item.label}</li>)}
        </ul>
        <span className={styles.footerIndex}>EARTH / 01</span>
      </footer>
    </main>
  );
}
