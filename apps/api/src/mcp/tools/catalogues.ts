// The catalogue read tools — `list_catalogues` and `get_catalogue` — and the
// place the write tools named by the contract land next.
//
// Each answer is a small JSON document, not a prose paragraph: the agent
// relays facts and needs the ids the other tools take. What the tools say is
// the same scope the signed-in `GET /catalogues` answers, through the same
// modules, so a Catalogue a person cannot see in the app is one the agent
// cannot see either.

import { z } from "zod";
import type { CatalogueRead } from "@arcula/shared";
import { readableCatalogueFor } from "../../authorize";
import { catalogueWorkCounts } from "../../catalogueCounts";
import { listReadableCatalogues } from "../../catalogueList";
import { serializeCatalogue } from "../../serialize";
import { defineTool } from "../tool";

const listCataloguesInput = z.object({});

const getCatalogueInput = z.object({ catalogueId: z.string().min(1) });

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

  defineTool({
    name: "get_catalogue",
    description:
      "Read one Catalogue: its name, its Kind (fixed at creation), its " +
      "visibility, the caller's role when a member, and how many works it " +
      "holds by status. A member is told every status, a draft count " +
      "included; anyone else is told published works only. Deleted works " +
      "are never counted. A private Catalogue answers `forbidden` to an " +
      "account that is not a member; a missing or deleted one answers " +
      "`not-found`. Use `search_artworks` to read the works themselves.",
    inputSchema: getCatalogueInput,
    call: async ({ catalogueId }, userId) => {
      // The same read verdict the route uses: a member bypasses a Protected
      // catalogue's password challenge, a public one admits a visitor, and a
      // private one refuses a non-member in the app's own words.
      const { catalogue, audience } = await readableCatalogueFor(
        userId,
        catalogueId,
      );
      const role =
        audience === "member"
          ? catalogue.userId === userId
            ? "owner"
            : "collaborator"
          : undefined;
      // The wire document decides the fields the app has always exposed — the
      // Kind's validity, the absent description, and the password state as a
      // member-only fact.
      const document = serializeCatalogue(catalogue, {
        audience,
        ...(role === undefined ? {} : { role }),
      });
      return {
        id: document.id,
        name: document.name,
        kind: document.kind,
        visibility: document.isPublic ? "public" : "private",
        ...(document.isPasswordProtected === undefined
          ? {}
          : { passwordProtected: document.isPasswordProtected }),
        ...(document.description === undefined
          ? {}
          : { description: document.description }),
        ...(document.role === undefined ? {} : { role: document.role }),
        counts: await catalogueWorkCounts(catalogue.id, audience),
      };
    },
  }),
];
