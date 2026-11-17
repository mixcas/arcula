// The MCP transport: a fresh server per request, stateless, one JSON answer.
//
// `createMcpHandler` performs no token verification of its own — `authInfo`
// given to `fetch` is passed through as-is. That is the seam the guard relies
// on: the verified subject reaches the tools through the factory's context and
// a tool never sees the access token. `legacy: "reject"` is the 2026-07-28
// protocol only (no handshake, no session); `responseMode: "json"` is not a
// preference but the only deployable mode, because API Gateway's HTTP API
// cannot stream a response.
//
// A tool failure is an MCP error result whose text is the envelope's code and
// message, so the agent can relay it verbatim. The SDK would already turn a
// thrown error into `isError: true`; formatting it here is what keeps the
// code — a thrown `Error("forbidden")` would lose it.

import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { ApiError } from "../errors";
import { dispatchTool } from "./dispatcher";
import { tools } from "./registry";

const text = (value: string) => ({ type: "text" as const, text: value });

/** Anything that is not an `ApiError` is ours to keep quiet: the console gets
 *  the real one, the agent gets the envelope's safe default. */
const asApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  console.error("[mcp] unhandled tool failure:", error);
  return new ApiError("internal", "Something went wrong");
};

export const mcpHandler = createMcpHandler(
  (ctx) => {
    // The verified subject, and nothing else, is the tool layer's principal.
    // `requireMcpAuth` guarantees it; a request without one must not run a
    // tool as nobody.
    const userId = ctx.authInfo?.extra?.sub;
    if (typeof userId !== "string" || userId === "") {
      throw new Error("The MCP request carries no verified subject");
    }
    const server = new McpServer({ name: "arcula", version: "1.0.0" });
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args) => {
          try {
            const result = await dispatchTool({
              userId,
              name: tool.name,
              args,
            });
            return { content: [text(JSON.stringify(result))] };
          } catch (error) {
            const failure = asApiError(error);
            return {
              isError: true,
              content: [text(`${failure.code}: ${failure.message}`)],
            };
          }
        },
      );
    }
    return server;
  },
  { legacy: "reject", responseMode: "json" },
);
