import Image from "next/image";
import symbol from "../../../public/images/opengridworks/datavista-symbol.webp";
import wordmark from "../../../public/images/opengridworks/datavista-wordmark.webp";
import styles from "./BrandLogo.module.css";

export function BrandLogo() {
  return (
    <span className={styles.logo}>
      <Image className={styles.symbol} src={symbol} alt="" unoptimized />
      <Image className={styles.wordmark} src={wordmark} alt="DataVista" unoptimized />
    </span>
  );
}
