"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./design-renderer.module.css";

interface DesignErrorBoundaryProps {
  children: ReactNode;
}

interface DesignErrorBoundaryState {
  message: string | null;
}

/**
 * Keeps a malformed design tree from blanking the Deep app.
 *
 * The renderer already guards every array and object access, but a generated
 * tree is model output and a 3DUI primitive can still throw on an input we did
 * not anticipate. Anything thrown while rendering the tree is caught here and
 * shown as a short readable message in place of the page.
 */
export class DesignErrorBoundary extends Component<
  DesignErrorBoundaryProps,
  DesignErrorBoundaryState
> {
  state: DesignErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): DesignErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.trim().slice(0, 300);
    return { message: message || "Unknown rendering error." };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("DesignRenderer failed to render the design tree", error, info);
  }

  render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;
    return (
      <p className={styles.errorBox} role="alert" data-design-error>
        This part of the reconstruction could not be rendered: {message}
      </p>
    );
  }
}
