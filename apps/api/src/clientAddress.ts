// The address the unlock throttle counts against.
//
// Production is a Lambda behind an API Gateway HTTP API, and the one address a
// client cannot choose is the gateway's own `sourceIp`. The Lambda entry copies
// it into this header with `set`, which overwrites anything a client sent under
// the same name — so the header is trusted exactly where the adapter ran.
//
// A forwarding header (`x-forwarded-for`) is deliberately not read here: API
// Gateway appends to a client-supplied one, so a guesser could mint a fresh
// identity per attempt and the throttle would never see the same address
// twice. Locally, and in the tests that drive `app.request()` directly, the
// adapter is not in the loop and the header is absent: every such attempt
// shares one bucket, which is honest for a single machine and is why the
// throttle's API tests pass the header themselves.

/** The header the Lambda entry writes the gateway's client address into. */
export const CLIENT_ADDRESS_HEADER = "x-arcula-client-ip";

/** The shared bucket when no gateway named an address. */
export const UNKNOWN_CLIENT_ADDRESS = "unknown";

export const clientAddress = (header: string | null | undefined): string =>
  header?.trim() || UNKNOWN_CLIENT_ADDRESS;
