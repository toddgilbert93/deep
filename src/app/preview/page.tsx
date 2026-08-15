import type { Metadata } from "next";
import {
  DEMO_DESIGN_PAGE,
  DEMO_HIGHLIGHT_ID,
} from "@/app/_components/design-renderer/demo-design-page";
import { DesignRenderer } from "@/app/_components/design-renderer/DesignRenderer";

export const metadata: Metadata = {
  title: "Deep preview",
  description:
    "Static preview of the DesignRenderer using a hand-written design tree.",
};

/**
 * Backend-free preview of the design renderer. Renders the demo design page
 * with one node highlighted so the Phase 3 streaming outline can be checked
 * visually.
 */
export default function PreviewPage() {
  return (
    <div className="desperado-theme min-h-full p-8">
      <DesignRenderer
        page={DEMO_DESIGN_PAGE}
        highlightIds={[DEMO_HIGHLIGHT_ID]}
      />
    </div>
  );
}
