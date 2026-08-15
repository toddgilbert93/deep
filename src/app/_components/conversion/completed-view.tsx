"use client";

import { useState } from "react";

import { SpecRenderer } from "@/app/_components/spec-renderer/SpecRenderer";
import type { ReconstructionSpec } from "@/lib/reconstruction/events";
import type { JobCompletion } from "@/lib/reconstruction/reducer";

import { ActionButton } from "./action-button";
import styles from "./conversion.module.css";
import { formatElapsed } from "./use-elapsed";

export interface CompletedViewProps {
  result: ReconstructionSpec;
  completion: JobCompletion | null;
  elapsedMs: number | null;
  onConvertAnother(): void;
}

function formatTokens(value: number | undefined): string | null {
  if (value === undefined) return null;
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Terminal success view: a summary bar followed by the full-width rendered
 * reconstruction. The spec JSON toggle shows validated data as text.
 */
export function CompletedView({ result, completion, elapsedMs, onConvertAnother }: CompletedViewProps) {
  const [showJson, setShowJson] = useState(false);
  const usage = completion?.usage;
  const tokens = formatTokens(usage?.totalTokens);
  const inputTokens = formatTokens(usage?.inputTokens);
  const outputTokens = formatTokens(usage?.outputTokens);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className={styles.summaryBar} aria-label="Reconstruction summary">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`${styles.accent} text-base font-bold`}>{result.source.title || "Untitled page"}</span>
            <a
              href={result.source.url}
              target="_blank"
              rel="noreferrer noopener"
              className={`${styles.muted} ${styles.mono} truncate underline-offset-2 hover:underline`}
              style={{ maxWidth: "min(100%, 32rem)" }}
            >
              {result.source.url}
            </a>
          </p>
          <dl className={styles.summaryMeta}>
            <div>
              <dt>Model</dt>
              <dd>{completion?.model ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Nodes</dt>
              <dd>{result.nodes.length}</dd>
            </div>
            <div>
              <dt>Interactions</dt>
              <dd>{result.interactions.length}</dd>
            </div>
            <div>
              <dt>Unresolved</dt>
              <dd>{result.unresolved.length}</dd>
            </div>
            {tokens ? (
              <div>
                <dt>Tokens</dt>
                <dd>
                  {tokens}
                  {inputTokens && outputTokens ? ` (${inputTokens} in / ${outputTokens} out)` : ""}
                </dd>
              </div>
            ) : null}
            {elapsedMs !== null ? (
              <div>
                <dt>Time</dt>
                <dd>{formatElapsed(elapsedMs)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            variant="quiet"
            aria-expanded={showJson}
            aria-controls="conversion-spec-json"
            onClick={() => setShowJson((value) => !value)}
          >
            {showJson ? "Hide spec JSON" : "View spec JSON"}
          </ActionButton>
          <ActionButton onClick={onConvertAnother}>Convert another</ActionButton>
        </div>
      </section>

      {showJson ? (
        <pre id="conversion-spec-json" className={styles.specJson} tabIndex={0} aria-label="Reconstruction spec JSON">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}

      {result.unresolved.length > 0 ? (
        <details className={`${styles.muted} text-sm`}>
          <summary className="cursor-pointer">
            {result.unresolved.length} source element{result.unresolved.length === 1 ? "" : "s"} could not be mapped
          </summary>
          <ul className="mt-2 list-disc pl-6">
            {result.unresolved.map((entry) => (
              <li key={entry.sourceElementId}>
                <span className={styles.mono}>{entry.sourceElementId}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section aria-label="Reconstructed 3D page" className="w-full">
        <SpecRenderer
          nodes={result.nodes}
          page={result.page}
          source={result.source}
          interactions={result.interactions}
        />
      </section>
    </div>
  );
}
