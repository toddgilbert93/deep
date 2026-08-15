import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./Image3D.module.css";

export type Image3DProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
  width?: number;
  height?: number;
  depth?: number;
};

export function Image3D({
  children,
  width = 320,
  height = 200,
  depth = 0,
  className,
  style,
  ...props
}: Image3DProps) {
  const vars = {
    "--ui3d-w": `${width}px`,
    "--ui3d-h": `${height}px`,
    "--ui3d-d": `${depth}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={vars}
      {...props}
    >
      <div className={styles.media}>{children}</div>
      <div className={styles.scene} aria-hidden>
        <span className={styles.grade} />
        <span className={styles.key} />
        <span className={styles.spec} />
        <span className={styles.fill} />
        <span className={styles.bounce} />
        <span className={styles.occlude} />
        <span className={styles.rim} />
      </div>
    </div>
  );
}
