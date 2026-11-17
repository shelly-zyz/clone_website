import { globeTopicOrder, globeTopics, type WorkspaceTopic } from "@/lib/globe-topics";
import styles from "./SceneSwitcher.module.css";

export function GlobeNavigation({ activeTopic, onTopicChange, onTopicIntent }: {
  activeTopic: WorkspaceTopic;
  onTopicChange: (topic: WorkspaceTopic) => void;
  onTopicIntent: (topic: WorkspaceTopic) => void;
}) {
  return (
    <nav className={`${styles.bar} og-globe-navigation`} aria-label="地球专题">
      {globeTopicOrder.map(topic => (
        <button key={topic} type="button" data-topic={topic} aria-pressed={activeTopic === topic}
          onClick={() => onTopicChange(topic)} onPointerEnter={() => onTopicIntent(topic)} onFocus={() => onTopicIntent(topic)}>
          {globeTopics[topic].label}
        </button>
      ))}
    </nav>
  );
}
