/**
 * The smoke's pipeline access (Phase 6 S3). The deploy bundle (index.js)
 * exports only the Lambda handler; the smoke drives Sharp directly through
 * the pipeline to measure a real 12 MP photo without an S3 round trip.
 * Built with the same flags as index.js, so this is the same pipeline code
 * that ships — it exists only in the smoke, never in the package.
 */
export {
  generateVariants,
  orientSource,
  sourceDimensions,
} from "../src/media/pipeline";
