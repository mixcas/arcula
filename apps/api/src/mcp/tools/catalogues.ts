// The catalogue tools. One today — `list_catalogues`, the tracer bullet's read
// — and the place the write tools named by the contract land next.
//
// Each answer is a small JSON document, not a prose paragraph: the agent
// relays facts and needs the ids the other tools take. What the tool says is
// the same scope the signed-in `GET /catalogues` answers, through the same
// module, so a Catalogue a person cannot see in the app is one the agent
// cannot see either.

import { z } from "zod";
import type { CatalogueRead } from "@arcula/shared";
import { listReadableCatalogues } from "../../catalogueList";
import { defineTool } from "../tool";

const listCataloguesInput = z.object({});

/** One Catalogue as `list_catalogues` names it: the identity the other tools
 *  take, the Kind (fixed at creation), its visibility, and the caller's role.
 *  The owner's display name rides only a shared row — an owned catalogue's
 *  owner is the caller. */
const catalogueSummary = (catalogue: CatalogueRead) => ({
  id: catalogue.id,
  name: catalogue.name,
  kind: catalogue.kind,
  visibility: catalogue.isPublic ? "public" : "private",
  // A public catalogue may still require its password for a visitor. The tool
  // is the member's, so this is a fact about the Catalogue, not a challenge.
  passwordProtected: catalogue.isPasswordProtected === true,
  role: catalogue.role,
  ...(catalogue.role === "collaborator" && catalogue.ownerName
    ? { ownerName: catalogue.ownerName }
    : {}),
});

export const catalogueTools = [
  defineTool({
    name: "list_catalogues",
    description:
      "List the Catalogues this account owns or collaborates on, with the " +
      "caller's role on each. A Catalogue holds Artworks. Its Kind is fixed " +
      "at creation: a Portfolio is the artist's name and bio, an Inventory " +
      "is the gallery's, and a Collection is neither. The free tier owns ten " +
      "Catalogues; shared ones do not count against it.",
    inputSchema: listCataloguesInput,
    call: async (_args, userId) => {
      const catalogues = await listReadableCatalogues(userId);
      const summaries = catalogues.map(catalogueSummary);
      return { total: summaries.length, catalogues: summaries };
    },
  }),
];
