/**
 * Success variant for a page without images: `counts.images` is 0, no source
 * element carries an `assetId`, and no `Image3D` node is produced.
 */
import type { ReconstructionEvent } from "../events";
import { buildSuccessRun } from "./success";

export const EMPTY_IMAGES_EVENTS: readonly ReconstructionEvent[] = buildSuccessRun({
  includeImage: false,
});
