import styles from "./GlobeLoading.module.css";

export function GlobeLoading({ label }: { label: string }) {
  return (
    <div className={styles.status} role="status">
      <span className={styles.ring} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
