"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { workspaceHref, type WorkspaceTopic } from "@/lib/globe-topics";
import { lastWorkspaceHref } from "@/lib/workspace-context";

export function ReturnToGlobe({ topic }: { topic: WorkspaceTopic }) {
  const router = useRouter();
  return (
    <Link href={workspaceHref(topic)} prefetch={false} onClick={event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      router.push(lastWorkspaceHref(topic));
    }}>
      返回地球
    </Link>
  );
}
