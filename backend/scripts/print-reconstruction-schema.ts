import { RECONSTRUCTION_SPEC_SCHEMA } from "../src/reconstruction/reconstruction-spec-schema";

function main(): void {
  process.stdout.write(`${JSON.stringify(RECONSTRUCTION_SPEC_SCHEMA, null, 2)}\n`);
}

main();
