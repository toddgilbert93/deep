import { GrokClient } from "../src/providers/grok";

async function main(): Promise<void> {
  const client = new GrokClient();
  const models = (await client.listModels()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const configuredModel = client.model;
  const configuredModelIsAvailable = models.some(
    (model) =>
      model.id === configuredModel || model.aliases.includes(configuredModel),
  );

  console.log("Models available to this API key:");
  for (const model of models) {
    const aliases = model.aliases.length
      ? ` (aliases: ${model.aliases.join(", ")})`
      : "";
    console.log(`- ${model.id}${aliases}`);
  }

  console.log(
    `\nConfigured model ${JSON.stringify(configuredModel)} is ${
      configuredModelIsAvailable ? "available" : "not available"
    } to this API key.`,
  );

  if (!configuredModelIsAvailable) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Grok model check failed: ${message}`);
  process.exitCode = 1;
});
