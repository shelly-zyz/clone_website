import Link from "next/link";
import { BrandLogo } from "@/components/opengridworks/BrandLogo";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import { ReturnToGlobe } from "./ReturnToGlobe";
import styles from "./page.module.css";

export function AnalysisHeader({ topic, detail = false }: { topic: WorkspaceTopic; detail?: boolean }) {
  return (
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" aria-label="DataVista 首页" prefetch={false}>
        <BrandLogo />
      </Link>
      <nav className={styles.topLinks} aria-label="专题分析导航">
        {detail && <Link href={"/visualization?topic=" + topic}>全部专题</Link>}
        <ReturnToGlobe topic={topic} className={styles.returnLink} />
      </nav>
    </header>
  );
}
