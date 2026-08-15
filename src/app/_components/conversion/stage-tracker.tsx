"use client";

import type { ReconstructionStage } from "@/lib/reconstruction/events";
import { STAGE_COPY, STAGE_ORDER } from "@/lib/reconstruction/stage-copy";

import styles from "./conversion.module.css";

export interface StageTrackerProps {
  stage: ReconstructionStage | null;
  /** When the job is complete every step is done; when failed the current step is frozen. */
  status: "connecting" | "running" | "completed" | "failed";
  /** Stop the current-step pulse (e.g. while the transport is disconnected). */
  frozen?: boolean;
}

function stageIndex(stage: ReconstructionStage | null): number {
  if (!stage) return -1;
  return STAGE_ORDER.indexOf(stage);
}

export function StageTracker({ stage, status, frozen = false }: StageTrackerProps) {
  const current = status === "completed" ? STAGE_ORDER.length : stageIndex(stage);

  return (
    <ol
      className={[styles.tracker, frozen ? styles.trackerFrozen : ""].filter(Boolean).join(" ")}
      aria-label="Conversion stages"
    >
      {STAGE_ORDER.map((entry, index) => {
        const state: "done" | "current" | "upcoming" =
          index < current ? "done" : index === current && status !== "completed" ? "current" : "upcoming";
        const classes = [
          styles.trackerStep,
          state === "done" ? styles.trackerStepDone : "",
          state === "current" ? styles.trackerStepCurrent : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={entry} className={classes} aria-current={state === "current" ? "step" : undefined}>
            <span className={styles.trackerDot} aria-hidden />
            <span className={styles.trackerLabel}>{STAGE_COPY[entry].label}</span>
            <span className={styles.srOnly}>
              {state === "done" ? " (done)" : state === "current" ? " (in progress)" : " (upcoming)"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
