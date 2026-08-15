"use client";

import styles from "./conversion.module.css";

export interface ProgressBarProps {
  /** 0–100. */
  progress: number;
  /** Text description of the current stage for assistive technology. */
  label: string;
  /** Show a sliding indeterminate bar (e.g. while connecting at 0%). */
  indeterminate?: boolean;
}

export function ProgressBar({ progress, label, indeterminate = false }: ProgressBarProps) {
  const value = Math.min(100, Math.max(0, Math.round(progress)));
  return (
    <div
      role="progressbar"
      aria-label="Conversion progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuetext={indeterminate ? label : `${value}% — ${label}`}
      className={styles.progressTrack}
    >
      <div
        className={[styles.progressFill, indeterminate ? styles.progressFillIndeterminate : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
