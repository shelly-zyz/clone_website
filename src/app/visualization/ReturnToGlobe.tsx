"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { workspaceHref, type WorkspaceTopic } from "@/lib/globe-topics";
import { lastWorkspaceHref } from "@/lib/workspace-context";

export function ReturnToGlobe({ topic, className }: { topic: WorkspaceTopic; className: string }) {
  const router = useRouter();
  return (
    <Link className={className} href={workspaceHref(topic)} prefetch={false} onClick={event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      router.push(lastWorkspaceHref(topic));
    }}>
      <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
      返回地球
    </Link>
  );
}
