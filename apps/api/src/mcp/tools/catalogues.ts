// The catalogue tools: the reads a Connection starts from and the writes that
// let an agent make and shape a Catalogue.
//
// Each answer is a small JSON document, not a prose paragraph: the agent
// relays facts and needs the ids the other tools take. What the tools say is
// what the routes say — the same module, the same membership verdict, the same
// tier cap — so an account that cannot create or edit a Catalogue in the app
// cannot do it here either.
//
// The three rules the schemas cannot express ride the descriptions, because
// they are prompt text an agent reads before it chooses arguments:
//
//   - the Kind is required and fixed at creation — a Portfolio's name is the
//     artist's name and its description their bio, an Inventory's are the
//     gallery's;
//   - the free tier owns ten Catalogues, and `limit-reached` is terminal: relay
//     it to the person, never retry;
//   - a write spends the account's allowance, and a rate-limited answer is
//     worth retrying after the window.

import { z } from "zod";
import {
  catalogueCreateSchema,
  catalogueKindSchema,
  catalogueUpdateSchema,
  type CatalogueRead,
} from "@arcula/shared";
import { listReadableCatalogues } from "../../catalogueList";
import { createCatalogue, updateCatalogue } from "../../catalogueWrite";
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

/**
 * The create arguments. `kind` is the shared enum without the create schema's
 * `collection` default: a default is a coin flip the agent cannot see, and the
 * Kind never changes afterwards. Every other field keeps the create schema's
 * own rule.
 */
const createCatalogueInput = z.object({
  name: catalogueCreateSchema.shape.name,
  kind: catalogueKindSchema,
  description: catalogueCreateSchema.shape.description,
  isPublic: catalogueCreateSchema.shape.isPublic,
});

/**
 * The update arguments: the settings an agent may change, and no `kind`.
 * `z.object` strips an unknown key, so a caller that sends one changes only
 * the fields named here — which is what the API already does.
 */
const updateCatalogueInput = z.object({
  catalogueId: z.string().min(1, "A catalogue id is required"),
  name: catalogueUpdateSchema.shape.name,
  description: catalogueUpdateSchema.shape.description,
  isPublic: catalogueUpdateSchema.shape.isPublic,
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
    name: "create_catalogue",
    description:
      "Create a Catalogue owned by this account and answer it. `kind` is " +
      "required and is fixed at creation: a Portfolio is the artist's, whose " +
      "name is the artist's name and whose description is their bio; an " +
      "Inventory is a gallery's, whose name and description are the " +
      "gallery's; a Collection is a collector's, with neither surface. The " +
      "free tier owns ten Catalogues and shared ones do not count against " +
      "it; a `limit-reached` refusal is final — tell the person rather than " +
      "retrying.",
    inputSchema: createCatalogueInput,
    write: true,
    call: async (args, userId) => createCatalogue(userId, args),
  }),
  defineTool({
    name: "update_catalogue",
    description:
      "Change a Catalogue's name, description or visibility, and answer the " +
      "Catalogue as written. Any member — the owner or a Collaborator — may " +
      "write the settings. The Kind is fixed at creation and cannot be " +
      "changed here; on a Portfolio the name is the artist's name and the " +
      "description their bio, and on an Inventory they are the gallery's. An " +
      "absent field is left as it is; `description: null` clears it.",
    inputSchema: updateCatalogueInput,
    write: true,
    call: async ({ catalogueId, ...settings }, userId) =>
      updateCatalogue(userId, catalogueId, settings),
  }),
];
