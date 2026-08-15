"use client";

import type { ButtonHTMLAttributes } from "react";

import styles from "./conversion.module.css";

export type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "quiet" | "danger";
};

/** Square, keyline-only secondary control. Primary actions use Button3D. */
export function ActionButton({ variant = "default", className, type = "button", ...props }: ActionButtonProps) {
  const variantClass =
    variant === "quiet" ? styles.actionButtonQuiet : variant === "danger" ? styles.actionButtonDanger : "";
  return (
    <button
      type={type}
      className={[styles.actionButton, variantClass, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
