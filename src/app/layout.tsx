import type { Metadata } from "next";
import { XiaoyunSiteAssistant } from "@/components/opengridworks/XiaoyunAssistant";
import "./globals.css";
import "./globe-workspace.css";

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
      <body className="min-h-full flex flex-col">
        <XiaoyunSiteAssistant>{children}</XiaoyunSiteAssistant>
      </body>
    </html>
  );
}
