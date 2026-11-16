/**
 * The one upload failure the API does not answer.
 *
 * A staged upload is two transports: the presign and the process call go
 * through `api.ts` and fail with an `ApiRequestError`; the PUT between them
 * goes to the storage origin and fails with no envelope, and often no status
 * (the browser hides which on a CORS or connection failure). It lives in its
 * own module so a screen or a test can ask the question without importing the
 * service — and so mocking the service cannot erase the type the uploaders
 * switch on.
 */
export class MediaUploadError extends Error {
  constructor(message = "The file could not be uploaded to storage") {
    super(message);
    this.name = "MediaUploadError";
  }
}
