"use client";

import { useState } from "react";
import { Carousel3D } from "./Carousel3D";
import { CAROUSEL_MAX, CAROUSEL_MIN } from "./recipe";

const LABELS = ["About", "Work", "Notes", "Lab", "Press", "Contact", "Shop", "Blog"];
const COUNTS = Array.from(
  { length: CAROUSEL_MAX - CAROUSEL_MIN + 1 },
  (_, i) => CAROUSEL_MIN + i,
);

export function CarouselDemo() {
  const [count, setCount] = useState(6);

  return (
    <div className="flex w-full flex-col items-center">
      <Carousel3D count={count}>
        {LABELS.slice(0, count).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </Carousel3D>
      <div className="flex items-center gap-1 pb-5">
        {COUNTS.map((n) => {
          const selected = n === count;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              aria-pressed={selected}
              className={[
                "h-8 w-8 font-mono text-xs",
                selected
                  ? "bg-neutral-100 text-neutral-900"
                  : "border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
              ].join(" ")}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
