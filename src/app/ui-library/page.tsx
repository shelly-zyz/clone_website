import type { Metadata } from "next";
import { LibraryPreview } from "./library-preview";

export const metadata: Metadata = {
  title: "能碳 UI 组件库 · OpenGridWorks",
  description: "OpenGridWorks 能碳分析组件及交互预览",
};

export default function UiLibraryPage() {
  return <LibraryPreview />;
}
