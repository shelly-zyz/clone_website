import { globeTopicOrder, globeTopics, workspaceHref, type WorkspaceTopic } from "@/lib/globe-topics";
import styles from "./SceneSwitcher.module.css";

export function GlobeNavigation({ activeTopic, onTopicChange }: {
  activeTopic?: WorkspaceTopic;
  onTopicChange?: (topic: WorkspaceTopic) => void;
}) {
  return (
    <nav className={`${styles.bar} og-globe-navigation${onTopicChange ? " is-docked" : ""}`} aria-label="地球专题">
      {globeTopicOrder.map(topic => onTopicChange ? (
        <button key={topic} type="button" aria-pressed={activeTopic === topic} onClick={() => onTopicChange(topic)}>
          {globeTopics[topic].label}
        </button>
      ) : (
        <a key={topic} href={workspaceHref(topic)} aria-current={activeTopic === topic ? "page" : undefined}>
          {globeTopics[topic].label}
        </a>
      ))}
    </nav>
  );
}
