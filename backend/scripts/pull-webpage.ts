import { fetchWebpageSource } from "../src/webpage/fetch-webpage-source";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowPrivateNetwork = args.includes("--allow-private");
  const url = args.find((arg) => !arg.startsWith("--"));

  if (!url) {
    throw new Error(
      "Usage: npm run webpage:pull -- <url> [--allow-private]",
    );
  }

  const result = await fetchWebpageSource(url, { allowPrivateNetwork });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Webpage pull failed: ${message}`);
  process.exitCode = 1;
});
