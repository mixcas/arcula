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
 * not a secret and belongs in the bundle. Recording is production-only, and
 * "production" is a build fact rather than a guess about the current host:
 * `scripts/build-lambda.sh` exports `VITE_LOGROCKET_ENABLED=true` for the prod
 * bundle and `false` for dev's, so dev.arcula.art never initialises the
 * recorder, and neither does `vite dev`, a local build, or the test suite.
 *
 * The gate is that flag alone, not `import.meta.env.PROD`: the repo-root
 * `.env` pins `NODE_ENV=development`, so Vite reports `PROD` as false even in
 * a `vite build`. The build script is the one thing that knows which
 * environment it is packaging.
 *
 * `identify` takes the immutable `uid` alone. A name or an email is PII that
 * the session deliberately does not carry, and it would follow the user across
 * every future session.
 */

type LogRocketSdk = typeof import("logrocket");
type SetupReact = typeof import("logrocket-react").default;

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
 * Start recording, once, when the bundle was built for production with the
 * recorder enabled. The SDK and its React plugin are imported dynamically so
 * the chunk only loads in a browser that will actually use it — the test
 * runner never pays for it.
 */
export function initTelemetry(): void {
  if (
    sdk ||
    import.meta.env.VITE_LOGROCKET_ENABLED !== "true" ||
    APP_ID === ""
  ) {
    return;
  }

  void Promise.all([import("logrocket"), import("logrocket-react")]).then(
    ([lrMod, reactMod]) => {
      // Both packages are CommonJS (`export =` / `export default`), which
      // Vite's interop hands back as `default`; the logrocket fallback covers
      // a bundler that returns the object itself instead.
      const LogRocket =
        (lrMod as unknown as { default?: LogRocketSdk }).default ?? lrMod;
      const setupReact: SetupReact = reactMod.default;

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
      // Names the React components behind each click in replay. It only
      // annotates the tree the DOM capture already has, so it widens nothing
      // the redaction above does not already cover.
      setupReact();

      sdk = LogRocket;
      if (pendingUid) LogRocket.identify(pendingUid);
    },
  );
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
