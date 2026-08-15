"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type FormEvent } from "react";

import { Button3D } from "@/app/3DUI/_lib/button/Button3D";
import { TextShadow3D } from "@/app/3DUI/_lib/text-shadow/TextShadow3D";
import {
  createMockEventSource,
  createSseEventSource,
  type ReconstructionEventSource,
} from "@/lib/reconstruction/event-source";
import { FIXTURE_NAMES, FIXTURES, isFixtureName, type FixtureName } from "@/lib/reconstruction/fixtures";
import { useReconstruction } from "@/lib/reconstruction/use-reconstruction";

import { ActionButton } from "./conversion/action-button";
import { ConversionPanel } from "./conversion/conversion-panel";
import styles from "./conversion/conversion.module.css";

export function normalizePageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * URL submission + conversion experience.
 *
 * `useSearchParams` (for `?source=mock&fixture=<name>`) must live under a
 * Suspense boundary so the page can still be statically prerendered; the
 * fallback is a non-interactive copy of the form so the initial HTML keeps
 * the same shape.
 */
export function GoDeepForm() {
  return (
    <Suspense fallback={<GoDeepFormFallback />}>
      <GoDeepFormWithSource />
    </Suspense>
  );
}

function GoDeepFormWithSource() {
  const searchParams = useSearchParams();
  const mock = searchParams.get("source") === "mock";
  const fixtureParam = searchParams.get("fixture");
  const fixture: FixtureName = isFixtureName(fixtureParam) ? fixtureParam : "success";
  const unknownFixture = mock && fixtureParam && !isFixtureName(fixtureParam) ? fixtureParam : null;

  const eventSource = useMemo<ReconstructionEventSource>(() => {
    if (!mock) return createSseEventSource();
    const entry = FIXTURES[fixture];
    return createMockEventSource(entry.events, entry.options);
  }, [mock, fixture]);

  return (
    <GoDeepFormBody
      eventSource={eventSource}
      mockFixture={mock ? fixture : null}
      unknownFixture={unknownFixture}
    />
  );
}

interface GoDeepFormBodyProps {
  eventSource: ReconstructionEventSource;
  mockFixture: FixtureName | null;
  unknownFixture: string | null;
}

function GoDeepFormBody({ eventSource, mockFixture, unknownFixture }: GoDeepFormBodyProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { activeJob, isRunning, start, cancel, retry, dismiss } = useReconstruction({ eventSource });

  const canSubmit = Boolean(normalizePageUrl(url)) && !isRunning;
  const completed = activeJob?.status === "completed";
  const idle = activeJob === null;

  function startConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) return;

    const pageUrl = normalizePageUrl(url);
    if (!pageUrl) {
      setError("Paste a valid http(s) URL.");
      return;
    }

    setError(null);
    if (activeJob) dismiss();
    start(pageUrl);
  }

  return (
    <div
      className={[
        "flex w-full flex-1 flex-col",
        idle ? "items-center justify-center gap-6" : "items-stretch gap-8",
      ].join(" ")}
    >
      {completed ? (
        mockFixture ? (
          <div className="flex w-full justify-end">
            <MockBadge fixture={mockFixture} unknownFixture={unknownFixture} />
          </div>
        ) : null
      ) : (
        <div className={["flex w-full flex-col gap-3", idle ? "items-center" : "items-stretch"].join(" ")}>
          <UrlForm
            url={url}
            error={error}
            disabled={isRunning}
            busy={isRunning}
            compact={!idle}
            canSubmit={canSubmit}
            onUrlChange={(value) => {
              setUrl(value);
              setError(null);
            }}
            onSubmit={startConversion}
          />
          {mockFixture ? (
            <div className={idle ? "" : "flex w-full justify-end"}>
              <MockBadge fixture={mockFixture} unknownFixture={unknownFixture} />
            </div>
          ) : null}
        </div>
      )}

      {activeJob ? (
        <ConversionPanel job={activeJob} onRetry={retry} onCancel={cancel} onDismiss={dismiss} />
      ) : null}
    </div>
  );
}

interface UrlFormProps {
  url: string;
  error: string | null;
  disabled: boolean;
  /** A job is in flight: the submit label changes and the form is aria-busy. */
  busy?: boolean;
  /** Single-row layout used while a job is active so the panel gets the height. */
  compact?: boolean;
  canSubmit: boolean;
  onUrlChange?(value: string): void;
  onSubmit?(event: FormEvent<HTMLFormElement>): void;
}

function UrlForm({
  url,
  error,
  disabled,
  busy = false,
  compact = false,
  canSubmit,
  onUrlChange,
  onSubmit,
}: UrlFormProps) {
  const submitLabel = busy ? "Going Deep…" : "Go Deep";
  const input = (
    <input
      id="page-url"
      name="url"
      type="url"
      inputMode="url"
      autoComplete="url"
      spellCheck={false}
      placeholder="https://example.com"
      value={url}
      disabled={disabled}
      readOnly={!onUrlChange}
      onChange={(event) => onUrlChange?.(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? "page-url-error" : undefined}
      className={[
        "desperado-field w-full disabled:opacity-60",
        compact ? "min-w-0 flex-1 px-3 py-2 text-sm" : "px-4 py-3 text-base",
      ].join(" ")}
    />
  );
  const errorText = error ? (
    <p id="page-url-error" className="text-sm" style={{ color: "var(--error)" }}>
      {error}
    </p>
  ) : null;

  if (compact) {
    return (
      <form
        className="flex w-full flex-col gap-2"
        onSubmit={onSubmit ?? ((event) => event.preventDefault())}
        noValidate
        aria-busy={busy || undefined}
      >
        <div className="flex w-full items-center gap-3">
          <label htmlFor="page-url" className="shrink-0">
            <TextShadow3D fontSize={16} fontFamily="var(--font-body)" ink="var(--fluid-c3)">
              URL
            </TextShadow3D>
          </label>
          {input}
          <ActionButton type="submit" disabled={!canSubmit}>
            {submitLabel}
          </ActionButton>
        </div>
        {errorText}
      </form>
    );
  }

  return (
    <form
      className="flex w-full max-w-xl flex-col items-center gap-8"
      onSubmit={onSubmit ?? ((event) => event.preventDefault())}
      noValidate
      aria-busy={busy || undefined}
    >
      <div className="flex w-full flex-col gap-3">
        <label htmlFor="page-url">
          <TextShadow3D fontFamily="var(--font-body)" ink="var(--fluid-c3)">
            Add URL
          </TextShadow3D>
        </label>
        {input}
        {errorText}
      </div>

      <Button3D
        type="submit"
        width={200}
        disabled={!canSubmit}
        face="var(--accent)"
        ink="var(--ink-contrast)"
        fontFamily="var(--font-body)"
        className="disabled:cursor-not-allowed disabled:opacity-25"
      >
        {submitLabel}
      </Button3D>
    </form>
  );
}

function MockBadge({ fixture, unknownFixture }: { fixture: FixtureName; unknownFixture: string | null }) {
  return (
    <p className="m-0 flex flex-wrap items-center justify-center gap-2 text-center">
      <span className={styles.mockBadge} title={`Fixtures: ${FIXTURE_NAMES.join(", ")}`}>
        mock mode: {fixture}
      </span>
      {unknownFixture ? (
        <span className={`${styles.muted} text-xs`}>
          Unknown fixture &ldquo;{unknownFixture}&rdquo; — using &ldquo;success&rdquo;.
        </span>
      ) : null}
    </p>
  );
}

/** Static, non-interactive replica rendered while search params resolve. */
function GoDeepFormFallback() {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
      <UrlForm url="" error={null} disabled canSubmit={false} />
    </div>
  );
}
