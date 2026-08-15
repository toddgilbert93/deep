"use client";

import { type FormEvent, useState } from "react";
import { Button3D } from "@/app/3DUI/_lib/button/Button3D";
import { TextShadow3D } from "@/app/3DUI/_lib/text-shadow/TextShadow3D";

function normalizePageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

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

export function GoDeepForm() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);

  const canSubmit = Boolean(normalizePageUrl(url));

  function startConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const pageUrl = normalizePageUrl(url);
    if (!pageUrl) {
      setSubmittedUrl(null);
      setError("Paste a valid http(s) URL.");
      return;
    }

    setError(null);
    setSubmittedUrl(pageUrl);
  }

  return (
    <form
      className="flex w-full max-w-xl flex-col items-center gap-8"
      onSubmit={startConversion}
      noValidate
    >
      <div className="flex w-full flex-col gap-3">
        <label htmlFor="page-url">
          <TextShadow3D fontFamily="var(--font-body)" ink="var(--fluid-c3)">
            Add URL
          </TextShadow3D>
        </label>
        <input
          id="page-url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://example.com"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
            setSubmittedUrl(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "page-url-error" : undefined}
          className="desperado-field w-full px-4 py-3 text-base"
        />
        {error ? (
          <p id="page-url-error" className="text-sm" style={{ color: "var(--error)" }}>
            {error}
          </p>
        ) : null}
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
        Go Deep
      </Button3D>

      {submittedUrl ? (
        <p className="text-center text-sm" style={{ color: "var(--muted)" }}>
          Starting 2D → 3D conversion for {submittedUrl}
        </p>
      ) : null}
    </form>
  );
}
