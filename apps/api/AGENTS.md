# apps/api — agent notes

Read [the package README](README.md) for the routes and the module list, and
[the architecture map](../../docs/architecture.md) for what each file owns. This
file carries only what those do not.

- **Two runtimes.** `src/main.ts` serves locally under Bun; `src/lambda.ts` is
  the production entry on the Node 24 Lambda. A module both load cannot use a
  Bun-only global or API — Bun is the development server, not a capability the
  handler has.
- **Configuration is read once**, in `src/env.ts` at import. Do not read
  `process.env` in a route or a core; take the value in as an argument, as
  `responsePolicy.ts` does.
- **Routes own the wire; cores take a user id.** `catalogueWrite.ts`,
  `artworkWrite.ts` and `artworkImport.ts` are the write cores a route and an
  MCP tool share, and none imports a Hono type. Keep the status code and the
  envelope in `routes/`, and test the core directly.
- **No MCP type in a tool signature.** `src/mcp/dispatcher.ts` takes
  `{ userId, name, args }`, and `tool.ts` declares `call(args, userId)`. A new
  tool is a file under `src/mcp/tools/` plus its line in `registry.ts`; the
  transport does not change.
- **A session token is a cookie in a deployment.** `bearer()` is mounted only
  outside production (`bearerAuthAllowed` in `env.ts`, applied in `auth.ts`),
  and the deploy verifier asserts a production host refuses the token as an
  `Authorization` bearer. Only the suites' sign-in helpers use the bearer form.
- **The integration suite needs the local stack.** `bun run test:api` starts
  Postgres, SeaweedFS and Mailpit before Vitest runs; a test that mocks them is
  testing the mock. The mechanics are in [the testing
  doctrine](../../docs/testing.md).
