import Link from "next/link";
import Image from "next/image";
import { globeTopicOrder, globeTopics, type WorkspaceTopic } from "@/lib/globe-topics";

export function GlobeNavigation({ activeTopic, onTopicChange, onTopicIntent }: {
  activeTopic: WorkspaceTopic;
  onTopicChange?: (topic: WorkspaceTopic) => void;
  onTopicIntent?: (topic: WorkspaceTopic) => void;
}) {
  return (
    <nav className="og-globe-navigation" aria-label="地球专题">
      {globeTopicOrder.map(topic => {
        const content = <>
          <Image className="og-globe-navigation-icon" src={`/images/opengridworks/globes/${topic}.webp`}
            width={240} height={240} alt="" unoptimized />
          <span>{globeTopics[topic].label}</span>
        </>;
        return onTopicChange ? (
          <button key={topic} type="button" data-topic={topic} aria-pressed={activeTopic === topic}
            onClick={() => onTopicChange(topic)} onPointerEnter={() => onTopicIntent?.(topic)} onFocus={() => onTopicIntent?.(topic)}>
            {content}
          </button>
        ) : <Link key={topic} data-topic={topic} href={`/workspace?topic=${topic}`} aria-current={activeTopic === topic ? "page" : undefined}>{content}</Link>;
      })}
    </nav>
  );
}
