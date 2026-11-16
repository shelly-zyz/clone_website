import Image from "next/image";
import Link from "next/link";
import type { WorkspaceTopic } from "@/lib/globe-topics";
import { ReturnToGlobe } from "./ReturnToGlobe";
import styles from "./page.module.css";

export function AnalysisHeader({ topic, detail = false, landing = false }: { topic: WorkspaceTopic; detail?: boolean; landing?: boolean }) {
  return (
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" prefetch={false}>
        {landing ? <span className={styles.brandMark} aria-hidden="true" /> : <Image src="/images/opengridworks/logo-dark.webp" alt="" width={28} height={28} />}
        <span>OpenGridWorks</span>
      </Link>
      <nav className={styles.topLinks} aria-label="专题分析导航">
        {detail && <Link href={"/visualization?topic=" + topic}>全部专题</Link>}
        <ReturnToGlobe topic={topic} className={styles.returnLink} />
      </nav>
    </header>
  );
}
