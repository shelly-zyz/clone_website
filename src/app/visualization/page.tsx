import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowLeft, Maximize2 } from "lucide-react";
import { resolveWorkspaceTopic, workspaceHref } from "@/lib/globe-topics";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "可视化分析 | OpenGridWorks",
  description: "浏览 OpenGridWorks 的图表与地球场景模板。",
};

const templates = [
  {
    id: "echarts-line",
    renderer: "ECharts",
    title: "小时趋势折线",
    description: "用连续时间轴查看波动和峰值。示例为中国风电情景的小时容量因子。",
  },
  {
    id: "vchart-bar",
    renderer: "VChart",
    title: "分类对比柱状图",
    description: "在同一尺度上比较不同类别。示例采用国家能源局 2024 年全国电源装机数据。",
  },
  {
    id: "antv-line",
    renderer: "AntV G2",
    title: "年度变化折线",
    description: "按年对照长期变化。示例采用 GFDL-ESM4 SSP1-2.6 情景的全国风电容量因子。",
  },
  {
    id: "maplibre-globe",
    renderer: "MapLibre Globe",
    title: "电力设施地球",
    description: "在地理底图上查看设施分布。示例使用 OpenStreetMap 的中国电厂点位。",
  },
  {
    id: "three-scene",
    renderer: "Three.js",
    title: "设施点位三维场景",
    description: "把带经纬度的设施投影到球面。示例使用 OpenStreetMap 电厂点位样本。",
  },
];

export default async function VisualizationPage({ searchParams }: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const { topic } = await searchParams;
  const workspace = workspaceHref(resolveWorkspaceTopic(topic));

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <header className={styles.topbar}>
          <Link className={styles.brand} href="/" prefetch={false}>
            <Image src="/images/opengridworks/logo-dark.webp" alt="" width={28} height={28} />
            <span>OpenGridWorks</span>
          </Link>
          <Link className={styles.returnLink} href={workspace} prefetch={false}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回地球
          </Link>
        </header>
        <section className={styles.heroContent} aria-labelledby="visualization-title">
          <div className={styles.heroCopy}>
            <h1 id="visualization-title">可视化分析</h1>
            <p>用统计图表比较数据，用地球场景查看空间分布。</p>
            <a className={styles.browseLink} href="#templates">浏览模板 <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
          <Image
            className={styles.heroImage}
            src="/intro/graced-night-v1.webp"
            alt="GRACED 排放样本在夜间地球上的分布"
            width={960}
            height={960}
            sizes="(max-width: 680px) 52vw, 360px"
            loading="eager"
          />
        </section>
      </div>

      <section id="templates" className={styles.gallery} aria-labelledby="templates-title">
        <h2 id="templates-title">可视化模板</h2>
        <div className={styles.grid}>
          {templates.map(({ id, renderer, title, description }) => {
            const preview = `/visualization/${id}.webp`;
            return (
              <figure className={styles.card} key={id}>
                <div className={styles.cardHeading}>
                  <h3>{title}</h3>
                  <span>{renderer}</span>
                </div>
                <a className={styles.preview} href={preview} target="_blank" rel="noopener" aria-label={`查看${title}大图`}>
                  <Image
                    src={preview}
                    alt={`${title}示例`}
                    width={1000}
                    height={562}
                    sizes="(max-width: 680px) 92vw, (max-width: 1280px) 45vw, 544px"
                  />
                  <span className={styles.zoomIcon}><Maximize2 size={16} aria-hidden="true" /></span>
                </a>
                <figcaption>{description}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>
    </main>
  );
}
