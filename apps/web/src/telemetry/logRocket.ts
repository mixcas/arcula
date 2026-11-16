/**
 * LogRocket session replay, configured the way this product needs it rather
 * than the way the SDK defaults.
 *
 * Arcula handles credentials, so the recorder never sees a password:
 *
 * - **DOM:** no `inputSanitizer`. The SDK already skips every
 *   `input[type="password"]`, and every password field in the app renders
 *   through Mantine's `PasswordInput` (there is no plain-text password
 *   field). Names, emails and the rest of the form text are recorded on
 *   purpose — they are what makes a replay readable. A new password field
 *   must stay a `PasswordInput` for this to hold.
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
 * `identify` carries the name and email the member signed up with, so a
 * session can be found by either in the LogRocket dashboard. The uid stays
 * the immutable key; name and email are traits that may change.
 */

type LogRocketSdk = typeof import("logrocket");
type SetupReact = typeof import("logrocket-react").default;

/** The scalar/array values `track` accepts; ids only, never free text. */
type TrackProperties = Record<
  string,
  string | number | boolean | string[] | number[] | boolean[] | null | undefined
>;

/** What `identify` attaches to the account: the uid plus its searchable traits. */
interface IdentifyTraits {
  name?: string;
  email?: string;
}

/** Drop absent traits rather than sending nulls the SDK's index signature rejects. */
function toUserTraits(traits: IdentifyTraits): Record<string, string> {
  const supplied: Record<string, string> = {};
  if (traits.name) supplied.name = traits.name;
  if (traits.email) supplied.email = traits.email;
  return supplied;
}

/**
 * Unwrap a function default export across the shapes a CommonJS module reaches
 * us in. `logrocket-react` is CommonJS (`exports.default = setupReact`, with
 * `__esModule: true`): the dev pre-bundle flattens that to the function itself,
 * but the production bundle — and Node's ESM⇄CJS interop — hands back
 * `{ default: { default: setupReact } }`. Calling that wrapper is the
 * `TypeError: r is not a function` that aborted the `.then` before
 * `identify`, so take the first function we find and give up quietly if the
 * module is not shaped as expected (losing the React annotation is acceptable;
 * throwing inside telemetry is not).
 */
export function resolveFunctionExport<T>(mod: unknown): T | undefined {
  if (typeof mod === "function") return mod as T;
  const first = (mod as { default?: unknown } | null | undefined)?.default;
  if (typeof first === "function") return first as T;
  const second = (first as { default?: unknown } | null | undefined)?.default;
  return typeof second === "function" ? (second as T) : undefined;
}

const APP_ID: string =
  (import.meta.env.VITE_LOGROCKET_APP_ID as string | undefined) ??
  "wf0mol/arcula";

/** The SDK instance once the lazily imported chunk has loaded. */
let sdk: LogRocketSdk | null = null;

/**
 * The last identity seen before the chunk loaded. A returning member's session
 * can resolve in the tick between `initTelemetry` and the import landing, and
 * that identify must still reach the recorder.
 */
let pendingIdentify: { uid: string; traits: Record<string, string> } | null =
  null;

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
      // a bundler that returns the object itself instead, and
      // `resolveFunctionExport` covers the `logrocket-react` module being
      // wrapped one `default` deeper in a production build.
      const LogRocket =
        (lrMod as unknown as { default?: LogRocketSdk }).default ?? lrMod;
      const setupReact = resolveFunctionExport<SetupReact>(reactMod);

      // No `dom.inputSanitizer`: the SDK already skips `input[type=password]`,
      // and the name and email fields are deliberately recorded so a replay
      // reads like the screen the member saw.
      LogRocket.init(APP_ID, {
        network: {
          requestSanitizer: (request) => {
            if (isSensitivePath(request.url)) return null;
            return request;
          },
        },
      });
      // Names the React components behind each click in replay. It only
      // annotates the tree the DOM capture already has, so it widens nothing
      // the redaction above does not already cover. Optional on purpose: a
      // module shape we do not recognise must not break the recording, and
      // `identify` below is what makes the session findable.
      setupReact?.();

      sdk = LogRocket;
      if (pendingIdentify) {
        LogRocket.identify(pendingIdentify.uid, pendingIdentify.traits);
      }
    },
  );
}

/**
 * Associate the recording with the signed-in account: the uid is the key, the
 * name and email are the searchable traits. Absent values are omitted rather
 * than sent as null, so a later identify cannot blank a trait it does not have.
 */
export function identifyUser(uid: string, traits: IdentifyTraits = {}): void {
  const supplied = toUserTraits(traits);
  pendingIdentify = { uid, traits: supplied };
  sdk?.identify(uid, supplied);
}

/**
 * Record a product event. Called only after the write succeeded, so the
 * timeline matches what the account actually did.
 */
export function trackEvent(name: string, properties?: TrackProperties): void {
  void sdk?.track(name, properties);
}
