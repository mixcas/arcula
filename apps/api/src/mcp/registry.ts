// The tool registry: the one list the transport advertises and the dispatcher
// searches. A later ticket adds a group by writing `tools/<group>.ts` and
// spreading it here — no transport change, no new route.

import type { AnyToolDefinition } from "./tool";
import { catalogueTools } from "./tools/catalogues";

export const tools: AnyToolDefinition[] = [...catalogueTools];
