import { describe, expect, it } from "vitest";
import { resolveFunctionExport } from "@/telemetry/logRocket";

/**
 * `logrocket-react` is CommonJS and the default export reaches us in three
 * shapes depending on the bundler and the CJS⇄ESM interop. Only the last one
 * (the production build, and Node) is the shape that shipped: reading
 * `reactMod.default` there is an object, and calling it threw
 * `TypeError: r is not a function` before `identify` ran. A dev build flattens
 * the wrapper, so the regression is invisible in `vite dev` and in review —
 * which is what this test exists to catch.
 */
describe("resolveFunctionExport", () => {
  const fn = () => {};

  it("returns a bare function export", () => {
    expect(resolveFunctionExport(() => {})).toBeTypeOf("function");
  });

  it("unwraps the single `default` a dev pre-bundle produces", () => {
    expect(resolveFunctionExport({ default: fn })).toBe(fn);
  });

  it("unwraps the double `default` a production build produces", () => {
    expect(resolveFunctionExport({ default: { default: fn } })).toBe(fn);
  });

  it.each([
    undefined,
    null,
    42,
    "nope",
    {},
    { default: {} },
    { default: null },
  ])("gives up quietly on %j", (mod) => {
    expect(resolveFunctionExport(mod)).toBeUndefined();
  });
});
