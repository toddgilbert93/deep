import { GrokClient } from "../src/providers/grok";

const prompt =
  process.argv.slice(2).join(" ") ||
  "Reply with exactly: Grok connection successful";

async function main(): Promise<void> {
  const client = new GrokClient();
  const response = await client.generateText(prompt);

  console.log(
    JSON.stringify(
      {
        id: response.id,
        model: response.model,
        text: response.text,
        usage: response.usage,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Grok check failed: ${message}`);
  process.exitCode = 1;
});
