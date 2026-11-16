"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { beginGlobeHandoff } from "@/lib/globe-handoff";
import { globeTopicOrder, globeTopics, workspaceHref, type WorkspaceTopic } from "@/lib/globe-topics";
import { analysisHref, analysisTopics } from "@/lib/topic-analysis/catalog";
import { introChapters, type IntroTopic } from "./intro-chapters";
import type { IntroScene } from "./intro-particles";
import styles from "./IntroLanding.module.css";

type SceneStatus = "loading" | "ready" | "static";
const brandTitle = ["看见地球", "的变化"] as const;

export function IntroLanding() {
  const router = useRouter();
  const [topic, setTopic] = useState<IntroTopic>(null);
  const [displayed, setDisplayed] = useState<IntroTopic>(null);
  const [changing, setChanging] = useState(false);
  const [committedTopic, setCommittedTopic] = useState<IntroTopic>(null);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [paused, setPaused] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<IntroScene | null>(null);
  const currentTopic = useRef<IntroTopic>(null);
  const pausedRef = useRef(false);
  const staticRef = useRef(false);
  const textTimer = useRef<number>(undefined);
  const chapterButtons = useRef<Partial<Record<WorkspaceTopic, HTMLButtonElement>>>({});
  const chapter = displayed ? introChapters[displayed] : null;
  const title = chapter?.title ?? brandTitle;
  const cards = chapter?.views ?? ["power", "carbon"];
  const target = topic ?? "power";

  useEffect(() => {
    let cancelled = false;
    let renderer: IntroScene | null = null;
    let stopLoading: number | undefined;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const fallback = () => {
      window.clearTimeout(stopLoading);
      renderer?.dispose();
      renderer = null;
      scene.current = null;
      staticRef.current = true;
      setStatus("static");
    };

    function prepare() {
      window.clearTimeout(stopLoading);
      if (motion.matches) {
        fallback();
        return;
      }
      if (!canvas.current || renderer) return;
      staticRef.current = false;
      setStatus("loading");
      stopLoading = window.setTimeout(fallback, 5000);
      void import("./intro-particles").then(({ createIntroScene }) => {
        if (cancelled || staticRef.current || !canvas.current || renderer) return;
        try {
          renderer = createIntroScene(canvas.current, currentTopic.current, pausedRef.current, () => {
            window.clearTimeout(stopLoading);
            setStatus("ready");
          }, fallback);
          scene.current = renderer;
        } catch {
          fallback();
        }
      }).catch(() => { if (!cancelled) fallback(); });
    }

    prepare();
    motion.addEventListener("change", prepare);
    return () => {
      cancelled = true;
      window.clearTimeout(stopLoading);
      window.clearTimeout(textTimer.current);
      motion.removeEventListener("change", prepare);
      renderer?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    router.prefetch(workspaceHref(target));
  }, [router, target]);

  function choose(next: IntroTopic, commit: boolean) {
    if (commit) setCommittedTopic(next);
    if (next === currentTopic.current) return;
    currentTopic.current = next;
    setTopic(next);
    scene.current?.focus(next);
    window.clearTimeout(textTimer.current);
    if (status === "ready" && !paused && !staticRef.current) {
      setChanging(true);
      textTimer.current = window.setTimeout(() => {
        setDisplayed(next);
        setChanging(false);
      }, 145);
    } else {
      setDisplayed(next);
      setChanging(false);
    }
  }

  function playPause() {
    if (status !== "ready") return;
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    scene.current?.pause(next);
  }

  function openWorkspace() {
    if (!staticRef.current) beginGlobeHandoff(target);
  }

  function goToChapters(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    choose(globeTopicOrder[0], true);
    chapterButtons.current[globeTopicOrder[0]]?.focus({ preventScroll: true });
  }

  function onChapterKey(event: KeyboardEvent<HTMLElement>, at: WorkspaceTopic) {
    const index = globeTopicOrder.indexOf(at);
    const next = {
      ArrowRight: (index + 1) % globeTopicOrder.length,
      ArrowLeft: (index + globeTopicOrder.length - 1) % globeTopicOrder.length,
      Home: 0,
      End: globeTopicOrder.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const selected = globeTopicOrder[next];
    choose(selected, true);
    chapterButtons.current[selected]?.focus();
  }

  return (
    <main
      className={styles.landing}
      aria-label="OpenGridWorks 开屏"
      data-scene={status}
      data-topic={topic ?? "overview"}
      data-paused={paused ? "" : undefined}
      onKeyDown={event => {
        if (event.key === "Escape") choose(null, true);
      }}
    >
      <div className={styles.space} aria-hidden="true">
        <div className={styles.stars} />
        <div className={styles.poster}>
          <Image
            src={`/intro/atlas-poster-${topic ?? "overview"}.webp`}
            alt=""
            width={820}
            height={820}
            preload={topic === null}
            unoptimized
          />
        </div>
        <canvas className={styles.canvas} ref={canvas} />
        <div className={styles.veil} />
      </div>

      <div className={styles.frame}>
        <header className={styles.header}>
          <button type="button" className={styles.brand} onClick={() => choose(null, true)} aria-label="返回开屏总览">
            <Image src="/images/opengridworks/logo-dark.webp" alt="" width={32} height={32} />
            <span>OpenGridWorks</span>
          </button>
          <nav className={styles.topNav} aria-label="平台导航">
            <a href="#intro-chapters" onClick={goToChapters}>专题导览</a>
            <Link href="/visualization">专题分析</Link>
          </nav>
          <div className={styles.topTools}>
            {status === "ready" && (
              <button className={styles.controlButton} type="button" aria-label={paused ? "继续开屏动画" : "暂停开屏动画"} onClick={playPause}>
                {paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
              </button>
            )}
            <Link
              className={styles.skip}
              href={workspaceHref(target)}
              onNavigate={openWorkspace}
            >
              跳过导览 <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <div className={styles.main}>
          <section className={styles.story} aria-label="专题概览">
            <div className={styles.storyContent} data-changing={changing ? "" : undefined}>
              <div key={displayed ?? "overview"} className={styles.storyText}>
                <p className={styles.eyebrow}>{displayed ? globeTopics[displayed].label : "地球数据观测"}</p>
                <h1 className={styles.title} id="intro-title">
                  {title.map(line => <span key={line}>{line}</span>)}
                </h1>
                <p className={styles.description}>
                  {chapter?.description ?? "从电力、气象、碳排放和经济四个视角，探索真实数据在地球上的分布与变化。"}
                </p>
              </div>
            </div>
            <div className={styles.actions}>
              <Link className={styles.primary} href={workspaceHref(target)} onNavigate={openWorkspace}>
                {topic ? `进入${globeTopics[topic].label}` : "进入平台"}
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              {chapter ? (
                <button className={styles.chapterArrow} type="button" onClick={() => choose(null, true)} aria-label="返回开屏总览">
                  <ArrowLeft size={17} aria-hidden="true" />
                </button>
              ) : (
                <button className={styles.secondary} type="button" onClick={() => choose(globeTopicOrder[0], true)}>
                  观看导览 <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </section>

          <aside className={styles.recommended} aria-label="相关专题分析">
            <div className={styles.cards} key={displayed ?? "overview"}>
              {cards.map((view, index) => {
                const link = analysisTopics[view];
                return (
                  <Link key={view} href={analysisHref(view)} className={styles.card} data-lead={index === 0 ? "" : undefined}>
                    <Image
                      src={`/images/opengridworks/globes/${link.globe}.webp`}
                      width={240} height={240} alt="" unoptimized
                    />
                    <div>
                      <strong>{link.label}</strong>
                      <span>{link.title}</span>
                    </div>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </aside>
        </div>

        <footer className={styles.footer}>
          <nav className={styles.chapters} id="intro-chapters" aria-label="四个导览章节">
            {globeTopicOrder.map((key, index) => (
              <button
                className={styles.chapter}
                key={key}
                type="button"
                data-topic={key}
                data-preview={topic === key ? "" : undefined}
                aria-pressed={committedTopic === key}
                ref={button => {
                  if (button) chapterButtons.current[key] = button;
                  else delete chapterButtons.current[key];
                }}
                onFocus={() => choose(key, false)}
                onBlur={() => choose(committedTopic, false)}
                onPointerEnter={event => {
                  if (event.pointerType === "mouse") choose(key, false);
                }}
                onPointerLeave={event => {
                  if (event.pointerType === "mouse" && document.activeElement !== event.currentTarget) {
                    choose(committedTopic, false);
                  }
                }}
                onClick={() => choose(key, true)}
                onKeyDown={event => onChapterKey(event, key)}
              >
                <Image src={`/images/opengridworks/globes/${key}.webp`} alt="" width={240} height={240} unoptimized />
                <span>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <strong>{globeTopics[key].label}</strong>
                  <span>{introChapters[key].shortTitle}</span>
                </span>
              </button>
            ))}
          </nav>
          <div className={styles.credits}>
            <p>{chapter ? <a href={chapter.sourceUrl} target="_blank" rel="noreferrer">{chapter.source}</a> : "NASA · Blue Marble / VIIRS 2012"}</p>
            {chapter && <p>地球影像 · NASA</p>}
          </div>
        </footer>

        <p className="sr-only" aria-live="polite">{committedTopic ? `已选${globeTopics[committedTopic].label}导览` : ""}</p>
      </div>
    </main>
  );
}
