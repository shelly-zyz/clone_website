import { ChartNoAxesCombined, CloudSun, Leaf, Zap } from "lucide-react";
import { globeTopicOrder, globeTopics, type WorkspaceTopic } from "@/lib/globe-topics";

const topicIcons = {
  power: Zap,
  weather: CloudSun,
  carbon: Leaf,
  economy: ChartNoAxesCombined,
} as const;

export function GlobeNavigation({ activeTopic, onTopicChange, onTopicIntent }: {
  activeTopic: WorkspaceTopic;
  onTopicChange: (topic: WorkspaceTopic) => void;
  onTopicIntent: (topic: WorkspaceTopic) => void;
}) {
  return (
    <nav className="og-globe-navigation" aria-label="地球专题">
      {globeTopicOrder.map(topic => {
        const Icon = topicIcons[topic];
        return (
          <button key={topic} type="button" data-topic={topic} aria-pressed={activeTopic === topic}
            onClick={() => onTopicChange(topic)} onPointerEnter={() => onTopicIntent(topic)} onFocus={() => onTopicIntent(topic)}>
            <span className="og-globe-navigation-icon" aria-hidden="true"><Icon /></span>
            <span>{globeTopics[topic].label}</span>
          </button>
        );
      })}
    </nav>
  );
}
