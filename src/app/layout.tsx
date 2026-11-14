import type { Metadata } from "next";
import { GlobeHandoff } from "@/components/opengridworks/GlobeHandoff";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenGridWorks",
  description: "电源项目与电网基础设施地图",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}<GlobeHandoff /></body>
    </html>
  );
}
