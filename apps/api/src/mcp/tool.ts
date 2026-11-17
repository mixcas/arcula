// The tool declaration: what the registry holds and what the transport
// advertises, with no MCP type in it.
//
// It lives apart from the dispatcher so the import graph stays acyclic: a
// tool group imports `defineTool` here, the registry imports the group, and
// the dispatcher imports the registry. Keeping `defineTool` beside
// `dispatchTool` would make every group reach back into a module that is still
// evaluating.

import { z } from "zod";

/** One tool: an argument schema, prompt text, and the call. `call` receives
 *  the parsed arguments and the verified user id — never a token, a request
 *  or a Hono Context. */
export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  /** Prompt text. Reviewed like UI copy: it says Catalogue and Artwork, never
   *  the retired `collection`, and it carries the rules a schema cannot. */
  description: string;
  inputSchema: S;
  /** Whether the call writes. A write spends the account's allowance before
   *  it runs; a read is never metered. */
  write?: boolean;
  call: (args: z.output<S>, userId: string) => Promise<unknown>;
}

/** A tool as the registry holds it, with its argument type erased: the
 *  registry is a heterogeneous list, and the dispatcher validates before it
 *  calls, so nothing is inferred from the element type. */
export type AnyToolDefinition = ToolDefinition;

/**
 * Declare a tool so its `call` sees the schema's own argument type.
 *
 * The one cast is here: a `ToolDefinition` whose arguments are narrower than
 * the erased list element is sound only because `dispatchTool` parses the
 * arguments through that same schema before calling. Keeping the cast in one
 * constructor is what stops it spreading through the registry.
 */
export const defineTool = <S extends z.ZodObject>(
  tool: ToolDefinition<S>,
): AnyToolDefinition => tool;
