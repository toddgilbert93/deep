import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./Chrome3D.module.css";

export type Chrome3DProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  depth?: number;
};

export function Chrome3D({
  children,
  depth = 28,
  className,
  style,
  ...props
}: Chrome3DProps) {
  const vars = {
    "--ui3d-d": `${depth}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={vars}
      {...props}
    >
      <div className={styles.well}>{children}</div>
      <div className={styles.tunnel} aria-hidden>
        <div className={`${styles.wall} ${styles.top}`} />
        <div className={`${styles.wall} ${styles.right}`} />
        <div className={`${styles.wall} ${styles.bottom}`} />
        <div className={`${styles.wall} ${styles.left}`} />
      </div>
    </div>
  );
}
