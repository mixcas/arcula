/**
 * LogRocket session replay, configured the way this product needs it rather
 * than the way the SDK defaults.
 *
 * Arcula handles credentials and other people's artwork, so recording starts
 * with redaction on, not added later:
 *
 * - `dom.inputSanitizer` drops every input's value — the login and sign-up
 *   emails, the profile fields and the catalogue unlock password. The SDK
 *   already skips `type="password"`, but an email is just as identifying.
 * - `network.requestSanitizer` ignores the whole request/response pair for
 *   every route that carries a secret: Better Auth's `/api/auth/*` (sign-in,
 *   sign-up, password change, reset — the new password is in the body), the
 *   catalogue `…/unlock` route (`{ password }`), the invitation routes (the
 *   raw token is in the path) and the media routes (object keys, and user
 *   artwork in the response). Timing and errors elsewhere are still recorded.
 *
 * The app ID is a public client-side identifier, like a publishable key: it is
 * not a secret and belongs in the bundle. Recording is a production-build
 * concern only, so `vite dev` and the test suite never reach the service; set
 * `VITE_LOGROCKET_APP_ID=""` to switch it off for an environment that builds
 * for production but should not record.
 *
 * `identify` takes the immutable `uid` alone. A name or an email is PII that
 * the session deliberately does not carry, and it would follow the user across
 * every future session.
 */

type LogRocketSdk = typeof import("logrocket");

/** The scalar/array values `track` accepts; ids only, never free text. */
type TrackProperties = Record<
  string,
  string | number | boolean | string[] | number[] | boolean[] | null | undefined
>;

const APP_ID: string =
  (import.meta.env.VITE_LOGROCKET_APP_ID as string | undefined) ??
  "wf0mol/arcula";

/** The SDK instance once the lazily imported chunk has loaded. */
let sdk: LogRocketSdk | null = null;

/**
 * The last uid seen before the chunk loaded. A returning member's session can
 * resolve in the tick between `initTelemetry` and the import landing, and that
 * identify must still reach the recorder.
 */
let pendingUid: string | null = null;

/**
 * The routes whose request/response pairs LogRocket must not see. The check is
 * on the path only — the query string is how the media proxy names its object,
 * and the path is enough to recognise every route here. The URL is parsed
 * rather than string-matched because the SDK may hand back the absolute URL a
 * relative `fetch` resolved to.
 */
export function isSensitivePath(url: string): boolean {
  let path: string;
  try {
    path = new URL(url, "https://arcula.invalid").pathname;
  } catch {
    path = url.split("?")[0] ?? "";
  }
  if (!path.startsWith("/api/")) return false;
  return (
    // Sign-in, sign-up, change-password, reset-password: passwords in the body.
    path.startsWith("/api/auth/") ||
    // `POST /catalogues/:id/unlock`: the catalogue password in the body.
    /\/catalogues\/[^/]+\/unlock$/.test(path) ||
    // Invitations: the raw token is a path segment on preview and accept.
    path.startsWith("/api/v1/invitations") ||
    // `/api/v1/media?key=…` and the artwork media stage/process routes.
    /(^|\/)media(\/|$)/.test(path)
  );
}

/**
 * Start recording, once, if this is a production build with an app ID set.
 * The SDK is imported dynamically so the chunk only loads in a browser that
 * will actually use it — the test runner never pays for it.
 */
export function initTelemetry(): void {
  if (sdk || !import.meta.env.PROD || APP_ID === "") return;

  void import("logrocket").then((mod) => {
    // The package is `export =` (CommonJS), which Vite's interop hands back
    // as `default`; the fallback covers a bundler that returns the object
    // itself instead.
    const LogRocket =
      (mod as unknown as { default?: LogRocketSdk }).default ?? mod;
    LogRocket.init(APP_ID, {
      dom: {
        // Redact every input value, not only password fields.
        inputSanitizer: true,
      },
      network: {
        requestSanitizer: (request) => {
          if (isSensitivePath(request.url)) return null;
          return request;
        },
      },
    });
    sdk = LogRocket;
    if (pendingUid) LogRocket.identify(pendingUid);
  });
}

/** Associate the recording with the signed-in account by its immutable id. */
export function identifyUser(uid: string): void {
  pendingUid = uid;
  sdk?.identify(uid);
}

/**
 * Record a product event. Called only after the write succeeded, so the
 * timeline matches what the account actually did.
 */
export function trackEvent(name: string, properties?: TrackProperties): void {
  void sdk?.track(name, properties);
}
