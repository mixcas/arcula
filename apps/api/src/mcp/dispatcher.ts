// The tool dispatch seam: a name, an argument bag and a verified subject in;
// the module a route calls out. No MCP type appears in any signature here —
// the transport registers these tools and hands the dispatcher whatever the
// client sent, and only the tool's own Zod schema decides whether it is valid.
//
// Every failure is an `ApiError`, so the transport layer can answer the
// envelope's code and message verbatim. That is the property the agent
// depends on: `limit-reached` is relayed to the person, `validation` is fixed,
// `forbidden` ends the attempt.
//
// A later ticket adds a tool group by writing `tools/<group>.ts` and listing it
// in `registry.ts`; nothing in the transport changes.

import type { z } from "zod";
import { ApiError } from "../errors";
import { tools } from "./registry";

/** The validated fields a bad argument bag names, keyed by the Zod path. */
const fieldsOf = (error: z.ZodError): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.join(".") || "_"] = issue.message;
  }
  return fields;
};

/**
 * Run one tool call for one verified account.
 *
 * The arguments are parsed again even though the transport validated them:
 * the tool's schema is the request's only contract, and a tool reached by any
 * other path must still be safe. The dispatcher is where that promise is
 * kept, not the transport.
 */
export async function dispatchTool(request: {
  userId: string;
  name: string;
  args: unknown;
}): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === request.name);
  if (!tool) {
    throw new ApiError("validation", `There is no tool named ${request.name}`);
  }
  const parsed = tool.inputSchema.safeParse(request.args ?? {});
  if (!parsed.success) {
    throw new ApiError(
      "validation",
      "The arguments are not valid",
      fieldsOf(parsed.error),
    );
  }
  return tool.call(parsed.data, request.userId);
}
