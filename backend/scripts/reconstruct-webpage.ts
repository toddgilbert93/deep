import { reconstructWebpage } from "../src/workflow/reconstruct-webpage";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowPrivateNetwork = args.includes("--allow-private");
  const url = args.find((arg) => !arg.startsWith("--"));

  if (!url) {
    throw new Error(
      "Usage: npm run webpage:reconstruct -- <url> [--allow-private]",
    );
  }

  const result = await reconstructWebpage({
    url,
    allowPrivateNetwork,
    onEvent: (event) => {
      process.stderr.write(`${JSON.stringify(event)}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify(result.spec, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Webpage reconstruction failed: ${message}\n`);
  process.exitCode = 1;
});
