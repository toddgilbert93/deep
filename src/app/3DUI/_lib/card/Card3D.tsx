import type { CSSProperties, ReactNode } from "react";
import styles from "./Card3D.module.css";

export type Card3DProps = {
  children?: ReactNode;
  width?: number;
  height?: number;
  depth?: number;
  face?: string;
  ink?: string;
  fontFamily?: string;
  className?: string;
  style?: CSSProperties;
};

export function Card3D({
  children,
  width = 280,
  height = 160,
  depth = 32,
  face,
  ink,
  fontFamily,
  className,
  style,
}: Card3DProps) {
  const vars = {
    "--ui3d-w": `${width}px`,
    "--ui3d-h": `${height}px`,
    "--ui3d-d": `${depth}px`,
    ...(face ? { "--ui3d-face": face } : {}),
    ...(ink ? { "--ui3d-ink": ink } : {}),
    ...(fontFamily ? { "--ui3d-font": fontFamily } : {}),
    ...style,
  } as CSSProperties;

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={vars}
    >
      <div className={styles.box}>
        <div className={`${styles.face} ${styles.front}`}>{children}</div>
        <div className={`${styles.face} ${styles.back}`} aria-hidden />
        <div className={`${styles.face} ${styles.right}`} aria-hidden />
        <div className={`${styles.face} ${styles.left}`} aria-hidden />
        <div className={`${styles.face} ${styles.top}`} aria-hidden />
        <div className={`${styles.face} ${styles.bottom}`} aria-hidden />
      </div>
    </div>
  );
}
