"use client";

import { Button3D } from "@/app/3DUI/_lib/button/Button3D";
import type { JobError } from "@/lib/reconstruction/reducer";
import { describeError } from "@/lib/reconstruction/stage-copy";

import { ActionButton } from "./action-button";
import styles from "./conversion.module.css";

export interface FailedViewProps {
  error: JobError;
  sourceUrl: string | null;
  onRetry(): void;
  onTryAnother(): void;
}

/** Terminal failure: safe copy selected from `error.code`, never model text. */
export function FailedView({ error, sourceUrl, onRetry, onTryAnother }: FailedViewProps) {
  return (
    <div
      role="alert"
      className="flex w-full flex-col items-center gap-6 border p-6 text-center"
      style={{ borderColor: "var(--error)", borderRadius: "var(--radius)" }}
    >
      <div className="flex flex-col gap-2">
        <p className={`${styles.error} m-0 text-lg font-bold uppercase tracking-wide`}>Conversion failed</p>
        <p className="m-0 max-w-prose text-base">{describeError(error.code)}</p>
        {sourceUrl ? (
          <p className={`${styles.muted} ${styles.mono} m-0 break-all`}>{sourceUrl}</p>
        ) : null}
        <p className={`${styles.muted} ${styles.mono} m-0`}>
          code: {error.code}
          {error.retryable ? " · retryable" : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4">
        {error.retryable ? (
          <Button3D
            width={160}
            height={48}
            depth={24}
            tilt={1}
            face="var(--accent)"
            ink="var(--ink-contrast)"
            fontFamily="var(--font-body)"
            onClick={onRetry}
          >
            Retry
          </Button3D>
        ) : null}
        <ActionButton variant="quiet" onClick={onTryAnother}>
          Try another URL
        </ActionButton>
      </div>
    </div>
  );
}
