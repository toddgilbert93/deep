import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Metadata } from "next";

import { parseDesignPage } from "../../../../backend/src/design/parse-design-page";
import { DesignRenderer } from "@/app/_components/design-renderer/DesignRenderer";

export const metadata: Metadata = {
  title: "Deep — last generated page",
};

/**
 * Development harness: renders the most recent `webpage:design` output through
 * the real renderer, so generated-page quality can be reviewed without paying
 * for another model run. Produce the file with:
 *
 *   npm run --silent webpage:design -- <url> > backend/.cache/last-design.html
 */
export default async function LastDesignPage() {
  const file = path.join(process.cwd(), "backend/.cache/last-design.html");

  let html: string;
  try {
    html = await readFile(file, "utf8");
  } catch {
    return (
      <div className="desperado-theme min-h-full p-8">
        <p style={{ color: "var(--muted)" }}>
          No generated page yet. Run{" "}
          <code>npm run --silent webpage:design -- &lt;url&gt; &gt; backend/.cache/last-design.html</code>
        </p>
      </div>
    );
  }

  const page = parseDesignPage(html, { partial: false });

  return (
    <div className="desperado-theme min-h-full">
      <DesignRenderer page={page} />
    </div>
  );
}
