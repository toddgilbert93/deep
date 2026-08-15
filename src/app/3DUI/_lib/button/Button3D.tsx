import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import styles from "./Button3D.module.css";

export const BUTTON_TILTS = [
  { x: 12, y: -18, z: -4 },
  { x: 10, y: 16, z: 3 },
  { x: -8, y: -14, z: 5 },
  { x: 14, y: 8, z: -6 },
  { x: -6, y: 20, z: -3 },
  { x: 8, y: -10, z: 6 },
] as const;

export type Button3DProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
  width?: number;
  height?: number;
  depth?: number;
  spin?: boolean;
  nested?: boolean;
  tilt?: number;
  face?: string;
  ink?: string;
  fontFamily?: string;
};

function tiltVars(tilt: number | undefined) {
  if (tilt == null) return {};
  const pose = BUTTON_TILTS[((tilt % BUTTON_TILTS.length) + BUTTON_TILTS.length) % BUTTON_TILTS.length];
  return {
    "--ui3d-tilt-x": `${pose.x}deg`,
    "--ui3d-tilt-y": `${pose.y}deg`,
    "--ui3d-tilt-z": `${pose.z}deg`,
  };
}

export function Button3D({
  children = "Button",
  width = 180,
  height = 56,
  depth = 32,
  spin = true,
  nested = false,
  tilt,
  face,
  ink,
  fontFamily,
  className,
  style,
  type = "button",
  ...props
}: Button3DProps) {
  const vars = {
    "--ui3d-w": `${width}px`,
    "--ui3d-h": `${height}px`,
    "--ui3d-d": `${depth}px`,
    ...(face ? { "--ui3d-face": face } : {}),
    ...(ink ? { "--ui3d-ink": ink } : {}),
    ...(fontFamily ? { "--ui3d-font": fontFamily } : {}),
    ...tiltVars(tilt),
    ...style,
  } as unknown as CSSProperties;

  return (
    <button
      type={type}
      className={[styles.root, nested ? styles.nested : "", className]
        .filter(Boolean)
        .join(" ")}
      style={vars}
      {...props}
    >
      <span className={[styles.box, spin ? styles.spin : ""].filter(Boolean).join(" ")}>
        <span className={`${styles.face} ${styles.front}`}>{children}</span>
        <span className={`${styles.face} ${styles.back}`} aria-hidden />
        <span className={`${styles.face} ${styles.right}`} aria-hidden />
        <span className={`${styles.face} ${styles.left}`} aria-hidden />
        <span className={`${styles.face} ${styles.top}`} aria-hidden />
        <span className={`${styles.face} ${styles.bottom}`} aria-hidden />
      </span>
    </button>
  );
}

export function Button3DGroup({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={[styles.group, className].filter(Boolean).join(" ")}>{children}</div>
  );
}
