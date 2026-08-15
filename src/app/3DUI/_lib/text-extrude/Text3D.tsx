import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./Text3D.module.css";

const MIN_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 48;
const DEFAULT_DEPTH = 18;
const LAYER_COUNT = 18;

export type Text3DProps = HTMLAttributes<HTMLSpanElement> & {
  children?: ReactNode;
  fontSize?: number;
  depth?: number;
  ink?: string;
  fontFamily?: string;
};

export function Text3D({
  children,
  fontSize = DEFAULT_FONT_SIZE,
  depth = DEFAULT_DEPTH,
  ink,
  fontFamily,
  className,
  style,
  ...props
}: Text3DProps) {
  const size = Math.max(fontSize, MIN_FONT_SIZE);
  const steps = LAYER_COUNT - 1;
  const vars = {
    "--ui3d-d": `${depth}px`,
    "--ui3d-steps": steps,
    fontSize: `${size}px`,
    ...(ink ? { "--ui3d-ink": ink } : {}),
    ...(fontFamily ? { "--ui3d-font": fontFamily } : {}),
    ...style,
  } as CSSProperties;

  return (
    <span
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={vars}
      {...props}
    >
      <span className={styles.slab}>
        {Array.from({ length: LAYER_COUNT }, (_, k) => {
          const i = LAYER_COUNT - 1 - k;
          const isFront = i === 0;

          return (
            <span
              key={i}
              className={
                isFront ? `${styles.layer} ${styles.front}` : styles.layer
              }
              style={
                {
                  "--layer": i,
                  "--ui3d-t": i / steps,
                } as CSSProperties
              }
              aria-hidden={isFront ? undefined : true}
            >
              {children}
            </span>
          );
        })}
      </span>
    </span>
  );
}
