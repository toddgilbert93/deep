import { Children, type CSSProperties, type ReactNode } from "react";
import { Button3D } from "../button/Button3D";
import styles from "./Carousel3D.module.css";
import {
  carouselFitScale,
  carouselRadius,
  carouselRecipe,
  clampCarouselCount,
} from "./recipe";

export type Carousel3DProps = {
  children?: ReactNode;
  className?: string;
  spin?: boolean;
  count?: number;
};

export function Carousel3D({
  children,
  className,
  spin = true,
  count,
}: Carousel3DProps) {
  const items = Children.toArray(children);
  const { idleSpinMs, face } = carouselRecipe;
  const faceCount = clampCarouselCount(count ?? items.length);
  const radius = carouselRadius(faceCount);
  const scale = carouselFitScale(radius, face.width);
  const step = 360 / faceCount;
  const vars = {
    "--ui3d-w": `${face.width}px`,
    "--ui3d-h": `${face.height}px`,
    "--ui3d-d": `${face.depth}px`,
    "--radius": `${radius}px`,
    "--scene-scale": scale,
    "--idle-ms": `${idleSpinMs}ms`,
  } as unknown as CSSProperties;

  return (
    <div
      className={[styles.stage, className].filter(Boolean).join(" ")}
      style={vars}
    >
      <div className={styles.scene}>
        <div className={[styles.ring, spin ? styles.spin : ""].filter(Boolean).join(" ")}>
          {Array.from({ length: faceCount }, (_, index) => (
            <div
              key={index}
              className={styles.slat}
              style={{ "--turn": `${step * index}deg` } as CSSProperties}
            >
              <Button3D
                nested
                spin={false}
                width={face.width}
                height={face.height}
                depth={face.depth}
              >
                {items[index] ?? `Tab ${index + 1}`}
              </Button3D>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
