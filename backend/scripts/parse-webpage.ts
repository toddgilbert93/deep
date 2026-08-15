import { FileImageAssetStore } from "../src/assets/file-image-asset-store";
import { cacheWebpageImages } from "../src/webpage/cache-webpage-images";
import { fetchWebpageSource } from "../src/webpage/fetch-webpage-source";
import { parseWebpageUi } from "../src/webpage/parse-webpage-ui";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowPrivateNetwork = args.includes("--allow-private");
  const url = args.find((arg) => !arg.startsWith("--"));

  if (!url) {
    throw new Error(
      "Usage: npm run webpage:parse -- <url> [--allow-private]",
    );
  }

  const source = await fetchWebpageSource(url, { allowPrivateNetwork });
  const parsed = parseWebpageUi(source);
  const withImages = await cacheWebpageImages(
    source,
    parsed,
    new FileImageAssetStore(),
    { allowPrivateNetwork },
  );
  console.log(JSON.stringify(withImages, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Webpage parse failed: ${message}`);
  process.exitCode = 1;
});
