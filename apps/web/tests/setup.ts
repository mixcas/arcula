// Web test environment bootstrap (runs once per test file, before the file's
// module graph).
//
// Installs the stack transport: the global fetch becomes the cookie-jar
// proxy emulator, so both the Better Auth react client and the service
// layer reach the real API on the local stack the way the dev browser
// reaches it through the Vite proxy. Node-environment files get the same
// wrapper (inert for anything that is not app-origin traffic).
//
// The session cookie is dropped after each file: a file that signs in must
// not leak its session into the next file's expectations of anonymity.
import { afterAll } from "vitest";
import { installStackFetch, resetStackSession } from "./helpers/stackFetch";

installStackFetch();

afterAll(resetStackSession);

// jsdom implements no layout, so Element has no scroll methods — only the
// scrollTop/scrollLeft/scrollWidth/scrollHeight accessors. Mantine's datatable
// resets the viewport with `element.scrollTo({ top: 0, left: 0 })` inside a
// requestAnimationFrame callback (sort/page change), and the callback throws
// `X.scrollTo is not a function` whenever the rAF timer outlives the file's
// teardown — a scheduler race that turns a latent jsdom gap into a flaky
// red run (vitest 5 fails the run on uncaught timer errors, by the
// `dangerouslyIgnoreUnhandledErrors: false` decision above). The stub gives
// the method its browser contract so the callback runs in tests the way it
// runs in a browser. Only `scrollTo` is stubbed: it is the only scroll
// method any of our dependencies call. `behavior: "smooth"` cannot be
// emulated without a layout (treated as instant), and jsdom's
// scrollTop/scrollLeft are inert counters — there is no scroll range to
// clamp to, because there is no layout. Node-environment files have no
// Element global; the guard keeps the stub inert there.
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollTo !== "function"
) {
  Element.prototype.scrollTo = function (argX, argY) {
    if (typeof argX === "number" && typeof argY === "number") {
      this.scrollLeft = argX;
      this.scrollTop = argY;
      return;
    }
    const options = (argX ?? {}) as { left?: number; top?: number };
    if (typeof options.left === "number") this.scrollLeft = options.left;
    if (typeof options.top === "number") this.scrollTop = options.top;
  };
}
