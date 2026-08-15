"use client";

import { useMemo } from "react";

import { SpecRenderer } from "@/app/_components/spec-renderer/SpecRenderer";
import { RECONSTRUCTION_HIGHLIGHT_COLOR } from "@/lib/reconstruction/events";
import {
  selectOrderedElements,
  selectOrderedNodes,
  type JobCounts,
  type ReconstructionJobState,
} from "@/lib/reconstruction/reducer";
import { STAGE_COPY } from "@/lib/reconstruction/stage-copy";

import { ActionButton } from "./action-button";
import { CompletedView } from "./completed-view";
import styles from "./conversion.module.css";
import { FailedView } from "./failed-view";
import { ProgressBar } from "./progress-bar";
import { SourceElementList } from "./source-element-list";
import { StageTracker } from "./stage-tracker";
import { formatElapsed, useElapsed } from "./use-elapsed";

export interface ConversionPanelProps {
  job: ReconstructionJobState;
  onRetry(): void;
  onCancel(): void;
  onDismiss(): void;
}

const LONG_RUNNING_COPY = "This can take a minute or two — Grok is working";

const COUNT_LABELS: Array<{ key: keyof JobCounts; label: string }> = [
  { key: "elements", label: "elements" },
  { key: "connections", label: "connections" },
  { key: "images", label: "images" },
  { key: "nodes", label: "nodes" },
];

/**
 * Renders one conversion job by status:
 * - connecting/running → Phase 1 progress bar, Phase 2 stage tracker + counts,
 *   and (once elements or nodes arrive) the Phase 3 live source/reconstruction panes;
 * - completed → summary bar + full-width `SpecRenderer`;
 * - failed → alert with safe copy and retry when allowed;
 * - transport drop → inline notice over the last received state.
 */
export function ConversionPanel({ job, onRetry, onCancel, onDismiss }: ConversionPanelProps) {
  const elapsedMs = useElapsed(job.startedAt, job.finishedAt);

  if (job.status === "completed" && job.result) {
    return (
      <div className={styles.panel}>
        <LiveStatus text="Conversion complete." />
        <CompletedView
          result={job.result}
          completion={job.completion}
          elapsedMs={elapsedMs}
          onConvertAnother={onDismiss}
        />
      </div>
    );
  }

  if (job.status === "failed" && job.error) {
    return (
      <div className={styles.panel}>
        <FailedView error={job.error} sourceUrl={job.sourceUrl} onRetry={onRetry} onTryAnother={onDismiss} />
      </div>
    );
  }

  return <RunningView job={job} elapsedMs={elapsedMs} onRetry={onRetry} onCancel={onCancel} onDismiss={onDismiss} />;
}

interface RunningViewProps extends ConversionPanelProps {
  elapsedMs: number | null;
}

function RunningView({ job, elapsedMs, onRetry, onCancel, onDismiss }: RunningViewProps) {
  const stage = job.stage;
  const copy = stage ? STAGE_COPY[stage] : null;
  const label = copy?.label ?? "Connecting";
  const detail = copy?.detail ?? "Opening a connection to the conversion service.";
  const disconnected = job.connection === "disconnected";
  const elements = selectOrderedElements(job);
  const nodes = selectOrderedNodes(job);
  const showLive = elements.length > 0 || nodes.length > 0;
  const focus = job.focus;
  const highlightColor = focus?.highlightColor || RECONSTRUCTION_HIGHLIGHT_COLOR;
  const highlightNodeIds = focus?.reconstructionNodeIds ?? [];
  const annotations = useMemo(() => {
    const map: Record<string, string> = {};
    if (!focus?.annotation) return map;
    for (const id of focus.reconstructionNodeIds) map[id] = focus.annotation;
    return map;
  }, [focus]);
  const counts = COUNT_LABELS.filter((entry) => job.counts[entry.key] !== undefined);
  const liveText = disconnected
    ? "Connection lost. Showing the last received state."
    : `${label}. ${copy?.longRunning ? LONG_RUNNING_COPY + "." : detail}`;

  return (
    <div className={`${styles.panel} flex flex-col gap-6`}>
      <LiveStatus text={liveText} />

      {/* Phase 1: loading bar */}
      <section aria-label="Conversion status" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="m-0 flex items-baseline gap-3">
            <span className={`${styles.accent} text-base font-bold uppercase tracking-wide`}>{label}</span>
            <span className={`${styles.muted} text-sm`}>{detail}</span>
          </p>
          <p className={`${styles.muted} ${styles.mono} m-0 flex items-center gap-4`}>
            <span aria-label="Progress percentage">{job.progress}%</span>
            <span aria-label="Elapsed time">{formatElapsed(elapsedMs)}</span>
          </p>
        </div>
        <ProgressBar
          progress={job.progress}
          label={label}
          indeterminate={job.status === "connecting" && job.progress === 0 && !disconnected}
        />
        {job.message ? <p className={`${styles.muted} m-0 text-sm`}>{job.message}</p> : null}
      </section>

      {/* Phase 2: granular stage tracker */}
      <section aria-label="Conversion stages" className="flex flex-col gap-4">
        <StageTracker stage={stage} status={job.status} frozen={disconnected} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {counts.length > 0 ? (
            <dl className={styles.counts}>
              {counts.map((entry) => (
                <div key={entry.key} className={styles.countItem}>
                  <dt className={styles.countLabel}>{entry.label}</dt>
                  <dd className={styles.countValue}>{job.counts[entry.key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span />
          )}
          {!disconnected ? (
            <ActionButton variant="quiet" onClick={onCancel}>
              Cancel
            </ActionButton>
          ) : null}
        </div>
        {copy?.longRunning && !disconnected ? (
          <p className={`${styles.longRunning} m-0`}>
            {LONG_RUNNING_COPY} · {formatElapsed(elapsedMs)} elapsed
          </p>
        ) : null}
      </section>

      {disconnected ? (
        <div className={styles.notice} role="status">
          <span>
            <strong>Connection lost</strong> — showing the last received state.
            {job.transportError ? <span className={styles.muted}> {job.transportError}</span> : null}
          </span>
          <span className="flex flex-wrap items-center gap-3">
            <ActionButton onClick={onRetry}>Retry</ActionButton>
            <ActionButton variant="quiet" onClick={onDismiss}>
              Try another URL
            </ActionButton>
          </span>
        </div>
      ) : null}

      {/* Phase 3: live reconstruction */}
      {showLive ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <SourceElementList elements={elements} focus={focus} expectedCount={job.counts.elements} />
          <section className={styles.livePane} aria-labelledby="conversion-reconstruction-title">
            <header className={styles.paneHeader}>
              <span id="conversion-reconstruction-title" className={styles.paneTitle}>
                Reconstruction
              </span>
              <span>
                {nodes.length}
                {job.counts.nodes !== undefined ? ` / ${job.counts.nodes}` : ""} nodes
              </span>
            </header>
            {nodes.length === 0 ? (
              <p className={styles.emptyHint}>
                {copy?.longRunning
                  ? "Grok is mapping the recognized elements onto 3D components…"
                  : "Reconstructed nodes will appear here as they are validated."}
              </p>
            ) : (
              <div className={styles.reconstructionStage}>
                <SpecRenderer
                  nodes={nodes}
                  streaming
                  highlightNodeIds={highlightNodeIds}
                  highlightColor={highlightColor}
                  annotations={annotations}
                />
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** Polite live region so stage changes are announced without stealing focus. */
function LiveStatus({ text }: { text: string }) {
  return (
    <p aria-live="polite" aria-atomic="true" className={styles.srOnly}>
      {text}
    </p>
  );
}
