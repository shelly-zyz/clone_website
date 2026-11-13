import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { workspaceHref, type WorkspaceTopic } from "@/lib/globe-topics";
import styles from "./page.module.css";

export function AnalysisHeader({ topic, detail = false }: { topic: WorkspaceTopic; detail?: boolean }) {
  return (
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" prefetch={false}>
        <Image src="/images/opengridworks/logo-dark.webp" alt="" width={28} height={28} />
        <span>OpenGridWorks</span>
      </Link>
      <nav className={styles.topLinks} aria-label="专题分析导航">
        {detail && <Link href={"/visualization?topic=" + topic}>全部专题</Link>}
        <Link className={styles.returnLink} href={workspaceHref(topic)} prefetch={false}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回地球
        </Link>
      </nav>
    </header>
  );
}
