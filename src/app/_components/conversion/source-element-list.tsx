"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import type { StreamedSourceElement } from "@/lib/reconstruction/events";
import { RECONSTRUCTION_HIGHLIGHT_COLOR } from "@/lib/reconstruction/events";
import type { JobFocus } from "@/lib/reconstruction/reducer";

import styles from "./conversion.module.css";

export interface SourceElementListProps {
  elements: readonly StreamedSourceElement[];
  focus: JobFocus | null;
  /** Total parsed elements when known (from `counts.elements`). */
  expectedCount?: number;
}

function elementLabel(element: StreamedSourceElement): string {
  return element.name ?? element.text ?? "";
}

/**
 * Compact rows of recognized source elements. The element(s) referenced by
 * `focus.sourceElementIds` get the green highlight outline and the annotation
 * as a floating label. Text only — nothing from the stream is rendered as HTML.
 */
export function SourceElementList({ elements, focus, expectedCount }: SourceElementListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const focusedIds = focus?.sourceElementIds ?? [];
  const focusedSet = new Set(focusedIds);
  const highlightColor = focus?.highlightColor || RECONSTRUCTION_HIGHLIGHT_COLOR;
  const focusKey = focus?.sequence ?? -1;
  const firstFocusedId = focusedIds[0] ?? null;

  useEffect(() => {
    if (!firstFocusedId || !listRef.current) return;
    const container = listRef.current;
    const row = container.querySelector<HTMLElement>(`[data-element-id="${cssEscape(firstFocusedId)}"]`);
    if (!row) return;
    const target = row.offsetTop - container.clientHeight / 2 + row.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, target) });
  }, [firstFocusedId, focusKey]);

  const highlightStyle = { "--highlight": highlightColor } as CSSProperties;

  return (
    <section className={styles.livePane} aria-labelledby="conversion-source-title">
      <header className={styles.paneHeader}>
        <span id="conversion-source-title" className={styles.paneTitle}>
          Source
        </span>
        <span>
          {elements.length}
          {expectedCount !== undefined ? ` / ${expectedCount}` : ""} elements
        </span>
      </header>
      {elements.length === 0 ? (
        <p className={styles.emptyHint}>Waiting for the parser to recognize UI elements…</p>
      ) : (
        <ol ref={listRef} className={styles.elementList} style={highlightStyle} aria-label="Recognized source elements">
          {elements.map((element) => {
            const focused = focusedSet.has(element.id);
            const label = elementLabel(element);
            return (
              <li
                key={element.id}
                data-element-id={element.id}
                className={[styles.elementRow, focused ? styles.elementRowFocused : ""].filter(Boolean).join(" ")}
                aria-current={focused ? "true" : undefined}
              >
                {focused && focus?.annotation ? (
                  <span className={styles.annotation}>{focus.annotation}</span>
                ) : null}
                <span className={styles.elementRole}>{element.role}</span>
                <span className={styles.elementName} title={label || undefined}>
                  <span className={styles.elementTag}>&lt;{element.tag}&gt;</span>
                  {label ? ` ${label}` : ""}
                  {element.assetId ? <span className={styles.elementTag}> · image asset</span> : null}
                </span>
                <span className={[styles.elementSelector, styles.mono].join(" ")}>{element.selector}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
