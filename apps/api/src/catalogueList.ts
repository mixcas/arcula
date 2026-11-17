// The signed-in catalogue list, as one module: the route that serves it and
// the MCP `list_catalogues` tool both read it, so the two cannot answer
// different memberships or different roles.
//
// The query lives here rather than in the route for one reason: the tool layer
// has no Hono Context, and handing it the route's SQL would be a second
// authorization verdict to keep in step. `catalogueScope.ts` is the filter —
// owned OR collaborated on, deleted excluded — and this module is the one
// caller that adds the owner's display name to a shared row.

import { asc, eq } from "drizzle-orm";
import {
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogues as cataloguesTable,
  user as userTable,
} from "@arcula/db";
import type { CatalogueRead } from "@arcula/shared";
import { collaboratorJoin, readableCataloguesWhere } from "./catalogueScope";
import { db } from "./db";
import { displayName, serializeCatalogue } from "./serialize";

/**
 * Every live catalogue the account owns or collaborates on, name-ordered, each
 * row carrying the caller's `role` — and, on a shared row, the owner's display
 * name.
 *
 * One query, so the two halves share one collation and a stray membership row
 * for the owner cannot list the catalogue twice: the owner column decides the
 * role, and the join only says "shared with this account".
 */
export async function listReadableCatalogues(
  userId: string,
): Promise<CatalogueRead[]> {
  const rows = await db
    .select({
      catalogue: cataloguesTable,
      ownerName: userTable.name,
      ownerEmail: userTable.email,
    })
    .from(cataloguesTable)
    .innerJoin(userTable, eq(userTable.id, cataloguesTable.userId))
    .leftJoin(catalogueCollaboratorsTable, collaboratorJoin(userId))
    .where(readableCataloguesWhere(userId))
    .orderBy(asc(cataloguesTable.name));

  return rows.map(({ catalogue, ownerName, ownerEmail }) => {
    if (catalogue.userId === userId) {
      return serializeCatalogue(catalogue, {
        role: "owner",
        audience: "member",
      });
    }
    // The glossary's "the owner's display name, falling back to email": an
    // account with no usable name is named by its address.
    return serializeCatalogue(catalogue, {
      role: "collaborator",
      ownerName: displayName(ownerName, ownerEmail),
      audience: "member",
    });
  });
}
