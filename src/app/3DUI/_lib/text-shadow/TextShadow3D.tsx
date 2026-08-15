import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./TextShadow3D.module.css";

const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 20;
const DEFAULT_DEPTH = 4;

export type TextShadow3DProps = HTMLAttributes<HTMLSpanElement> & {
  children?: ReactNode;
  fontSize?: number;
  depth?: number;
  ink?: string;
  fontFamily?: string;
};

export function TextShadow3D({
  children,
  fontSize = DEFAULT_FONT_SIZE,
  depth = DEFAULT_DEPTH,
  ink,
  fontFamily,
  className,
  style,
  ...props
}: TextShadow3DProps) {
  const size = Math.min(MAX_FONT_SIZE, Math.max(fontSize, MIN_FONT_SIZE));
  const vars = {
    "--ui3d-d": `${depth}px`,
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
      {children}
    </span>
  );
}
