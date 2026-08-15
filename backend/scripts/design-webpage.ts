/**
 * Local end-to-end design run.
 *
 * Writes the generated HTML to stdout and ordered progress events as NDJSON to
 * stderr. This makes a billable xAI request.
 *
 *   npm run --silent webpage:design -- https://example.com > page.html 2> events.ndjson
 */
import { designWebpage } from "../src/workflow/design-webpage";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowPrivateNetwork = args.includes("--allow-private");
  const url = args.find((arg) => !arg.startsWith("--"));

  if (!url) {
    throw new Error("Usage: npm run webpage:design -- <url> [--allow-private]");
  }

  const started = Date.now();
  const marks: string[] = [];

  const briefDump = process.env.DEEP_DUMP_BRIEF;

  const result = await designWebpage({
    url,
    allowPrivateNetwork,
    onEvent: (event) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (event.type === "design.page") {
        marks.push(
          `${elapsed}s snapshot ${event.page.stats.elements} elements / ${event.generatedCharacters} chars`,
        );
      } else if (event.type === "workflow.status" || event.type === "workflow.failed") {
        marks.push(`${elapsed}s ${event.stage} ${event.progress}% ${event.message}`);
      }
      process.stderr.write(`${JSON.stringify(event)}\n`);
    },
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(
    `\n--- summary ---\n${marks.join("\n")}\n\npalette ${JSON.stringify(result.brief.palette)} | ` +
      `fonts ${JSON.stringify(result.brief.fonts)} | blocks ${result.brief.stats.blocks} | ` +
      `brief tokens ~${result.brief.stats.approxTokens}\n` +
      `total ${seconds}s | model ${result.model} | ` +
      `elements ${result.page.stats.elements} | components ${JSON.stringify(result.page.stats.components)}\n`,
  );
  if (briefDump) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(briefDump, `${JSON.stringify(result.brief, null, 2)}\n`, "utf8");
    process.stderr.write(`brief written to ${briefDump}\n`);
  }
  process.stdout.write(result.html);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Design run failed: ${message}\n`);
  process.exitCode = 1;
});
