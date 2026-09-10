import type { Metadata } from "next";
import { ChinaDashboardShell } from "@/components/china-dashboard/ChinaDashboardShell";

export const metadata: Metadata = {
  title: "中国电力运行研究台 | OpenGridWorks",
  description: "全国电力统计、公开设施样本、彩色地貌与超短期预测工作流界面。",
};

export default function ChinaDashboardPage() {
  return <ChinaDashboardShell />;
}
