import type { CSSProperties } from "react";
import styles from "./Icon3D.module.css";

export const ICON3D_NAMES = [
  "plus",
  "minus",
  "close",
  "check",
  "chevronLeft",
  "chevronRight",
  "arrowUp",
  "menu",
  "square",
  "play",
  "more",
  "cuboid",
] as const;

export type Icon3DName = (typeof ICON3D_NAMES)[number];

export type Icon3DProps = {
  name: Icon3DName;
  size?: number;
  depth?: number;
  spin?: boolean;
  face?: string;
  className?: string;
  style?: CSSProperties;
};

type BoxSpec = {
  w: number;
  h: number;
  x?: number;
  y?: number;
  rz?: number;
};

const GLYPHS: Record<Icon3DName, readonly BoxSpec[]> = {
  plus: [
    { w: 0.2, h: 0.7 },
    { w: 0.25, h: 0.2, x: -0.225 },
    { w: 0.25, h: 0.2, x: 0.225 },
  ],
  minus: [{ w: 0.7, h: 0.2 }],
  close: [
    { w: 0.72, h: 0.18, rz: 45 },
    { w: 0.72, h: 0.18, rz: -45 },
  ],
  check: [
    { w: 0.32, h: 0.16, x: -0.18, y: 0.14, rz: 45 },
    { w: 0.62, h: 0.16, x: 0.1, y: -0.02, rz: -48 },
  ],
  chevronLeft: [
    { w: 0.46, h: 0.16, x: 0.05, y: -0.145, rz: -45 },
    { w: 0.46, h: 0.16, x: 0.05, y: 0.145, rz: 45 },
  ],
  chevronRight: [
    { w: 0.46, h: 0.16, x: -0.05, y: -0.145, rz: 45 },
    { w: 0.46, h: 0.16, x: -0.05, y: 0.145, rz: -45 },
  ],
  arrowUp: [
    { w: 0.44, h: 0.16, x: -0.13, y: -0.08, rz: -48 },
    { w: 0.44, h: 0.16, x: 0.13, y: -0.08, rz: 48 },
    { w: 0.16, h: 0.42, y: 0.16 },
  ],
  menu: [
    { w: 0.72, h: 0.14, y: -0.28 },
    { w: 0.72, h: 0.14 },
    { w: 0.72, h: 0.14, y: 0.28 },
  ],
  square: [{ w: 0.64, h: 0.64 }],
  play: [
    { w: 0.2, h: 0.72, x: -0.24 },
    { w: 0.2, h: 0.48 },
    { w: 0.2, h: 0.24, x: 0.24 },
  ],
  more: [
    { w: 0.18, h: 0.18, x: -0.32 },
    { w: 0.18, h: 0.18 },
    { w: 0.18, h: 0.18, x: 0.32 },
  ],
  cuboid: [{ w: 0.72, h: 0.48 }],
};

function ExtrudeBox({ w, h, x = 0, y = 0, rz = 0 }: BoxSpec) {
  const vars = {
    "--box-w": `calc(var(--ui3d-w) * ${w})`,
    "--box-h": `calc(var(--ui3d-h) * ${h})`,
    "--box-x": `calc(var(--ui3d-w) * ${x})`,
    "--box-y": `calc(var(--ui3d-h) * ${y})`,
    "--box-rz": `${rz}deg`,
  } as CSSProperties;

  return (
    <span className={styles.box} style={vars}>
      <span className={`${styles.face} ${styles.front}`} />
      <span className={`${styles.face} ${styles.back}`} />
      <span className={`${styles.face} ${styles.right}`} />
      <span className={`${styles.face} ${styles.left}`} />
      <span className={`${styles.face} ${styles.top}`} />
      <span className={`${styles.face} ${styles.bottom}`} />
    </span>
  );
}

export function Icon3D({
  name,
  size = 40,
  depth = 12,
  spin = true,
  face,
  className,
  style,
}: Icon3DProps) {
  const vars = {
    "--ui3d-w": `${size}px`,
    "--ui3d-h": `${size}px`,
    "--ui3d-d": `${depth}px`,
    ...(face ? { "--ui3d-face": face } : {}),
    ...style,
  } as CSSProperties;

  return (
    <span
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={vars}
      role="img"
      aria-label={name}
    >
      <span className={[styles.scene, spin ? styles.spin : ""].filter(Boolean).join(" ")}>
        {GLYPHS[name].map((box, index) => (
          <ExtrudeBox key={index} {...box} />
        ))}
      </span>
    </span>
  );
}
