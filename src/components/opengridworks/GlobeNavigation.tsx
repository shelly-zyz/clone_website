import Image from "next/image";
import { globeTopicOrder, globeTopics, workspaceHref, type WorkspaceTopic } from "@/lib/globe-topics";

export function GlobeNavigation({ activeTopic, onTopicChange }: {
  activeTopic?: WorkspaceTopic;
  onTopicChange?: (topic: WorkspaceTopic) => void;
}) {
  return (
    <nav className={`og-globe-navigation${onTopicChange ? " is-docked" : ""}`} aria-label="地球专题">
      {globeTopicOrder.map((topic) => {
        const preview = (
          <>
            <Image src={`/images/opengridworks/globes/${topic}.webp`} alt="" width={240} height={240} unoptimized />
            <span>{globeTopics[topic].label}</span>
          </>
        );

        return onTopicChange ? (
          <button key={topic} type="button" data-topic={topic} aria-pressed={activeTopic === topic} onClick={() => onTopicChange(topic)}>
            {preview}
          </button>
        ) : (
          <a key={topic} data-topic={topic} href={workspaceHref(topic)}>{preview}</a>
        );
      })}
    </nav>
  );
}
