# Session replay is redacted at the client, not trusted to the SDK's defaults

**Status**: accepted

We want a recording of what a member saw when they report a bug — the page
they were on, the request that failed, the toast that appeared. Session replay
answers that in a way server logs cannot. The risk is asymmetric, though: the
recording is uploaded to a third party, and this product's screens hold the
member's credentials and other people's artwork. A default install captures
more than anyone intended: passwords typed into the page are excluded by input
type, but those same passwords travel in the request bodies the SDK records,
and the vendor's setup page ships no PII sanitization.

## Decision

**LogRocket records, and the SDK is configured before its first frame.** The
app ID lives in `apps/web/src/telemetry/logRocket.ts` as a constant; it is a
public client-side identifier, like a publishable key, so it is neither a
secret nor read from the deployment environment. `initTelemetry()` runs in
`apps/web/src/main.tsx` before the first render.

**Recording is production-only, decided at build time.** The SPA is built once
per environment, so the switch travels with the bundle: `build-lambda.sh`
exports `VITE_LOGROCKET_ENABLED=true` for prod and `false` for dev, and
`initTelemetry` initialises the recorder only when the flag is the literal
`"true"`. Dev's bundle therefore never loads the SDK — not at `dev.arcula.art`,
not in `vite dev`, not in a local build, and not in the test suite.

The gate is that flag, not `import.meta.env.PROD`: the repo-root `.env` pins
`NODE_ENV=development`, which makes Vite report `PROD` as false even in a
`vite build`. A gate on `PROD` would have silently disabled production
recording, which is the failure this ADR exists to prevent.

**The React plugin annotates, it does not widen.** `logrocket-react` names the
components behind a click so replay can show `ArtworkFields` rather than a
`div`. It attaches names to the tree the DOM capture already holds, so every
redaction above still applies.

**The password is the thing redacted; the rest of the screen is the point.**
Three facts are true at `init`, not left to the defaults:

- **DOM:** `dom.inputSanitizer` is deliberately **not** set. The SDK already
  skips every `input[type="password"]`, and every password field in the app
  renders through Mantine's `PasswordInput` — login, sign-up, reset, the
  profile, the catalogue password control and the unlock screen — so no
  password reaches the recorder. Names, emails and the rest of the form text
  are recorded on purpose: they are what lets an engineer read a replay. A new
  password field must stay a `PasswordInput`; a plain text field holding a
  password would be captured.
- `network.requestSanitizer` ignores the whole request/response pair for the
  routes that carry a secret: `/api/auth/*` (sign-in, sign-up, password change,
  password reset — the new password is in the body), `…/catalogues/:id/unlock`
  (the catalogue password), the invitation routes (the raw token is a path
  segment) and the media routes (object keys in the query, user artwork in the
  response). Everywhere else, timing and error data are still recorded.
- `identify` takes the immutable `uid` as the key and the member's **name and
  email** as traits, so the dashboard can find a session by either. The uid
  stays the identity; name and email are searchable metadata that may change.

**Track the writes, not the screens.** `sign_up_completed`,
`artwork_created` and `catalogue_visibility_changed` are emitted after the
write succeeds, so the timeline matches what the account did. Event
properties carry ids, never titles or other free text.

## Known limitation

The invitation and password-reset tokens also ride the **page URL**
(`/invite/<token>`, `/reset-password/<token>`). LogRocket documents no
redaction for the recorded URL, and the token is already in the address bar
before the SDK's first frame. The exposures are bounded by the token's own
life — single use for an invitation, single use for a reset — and by the fact
that replay is an internal tool. If that bound is judged too loose, the fix is
to move those tokens out of the path (a fragment or a header), not to widen
the redaction.

Images are recorded by default. That is the product's content: for an artist's
own catalogue it is their work, and for a collector's it is other people's.
`dom.imageSanitizer: true` would remove all of it, at the cost of making
replay much less useful; the choice is recorded here so that it is a decision
and not an oversight.

## Rejected alternatives

- **`LogRocket.init(APP_ID)` with defaults.** One line, and it ships the unlock
  password, the sign-up password and the invitation token to the vendor. The
  SDK's own documentation separates DOM and network sanitization precisely
  because one does not imply the other.
- **Sanitize everything** (`textSanitizer`, `imageSanitizer`, `network.isEnabled:
false`). A replay of blank boxes answers none of the questions replay exists
  for; it is cheaper to record nothing.
- **A self-hosted recorder** (OpenReplay, Highlight). Real, but it is a
  service to run, and the decision to have replay at all is the expensive one;
  the vendor can be swapped behind the same three functions.
- **Error monitoring only** (Sentry). It answers "what threw", not "what did
  the member see", which is the recurring question this is for.
