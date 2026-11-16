// The membership scope shared by the reads that ask "which catalogues may
// this caller read?": the signed-in `/catalogues` list and the Artist Name
// aggregate. One definition, so the two cannot drift into two answers.

import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import {
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";

/**
 * The left join to the caller's own collaborator row. `(collectionId, userId)`
 * is unique, so the join finds at most one row; an owner is not in this table,
 * so their join finds nothing and the owner column decides the role.
 */
export const collaboratorJoin = (userId: string): SQL | undefined =>
  and(
    eq(catalogueCollaboratorsTable.collectionId, cataloguesTable.id),
    eq(catalogueCollaboratorsTable.userId, userId),
  );

/**
 * The live catalogues the caller owns or collaborates on, optionally narrowed
 * by the reading query's own conditions — the Artist Name aggregate adds the
 * live-works filter. `deletedAt` is the whole deletion record, so a deleted
 * catalogue is in neither branch.
 */
export const readableCataloguesWhere = (
  userId: string,
  ...conditions: (SQL | undefined)[]
): SQL | undefined =>
  and(
    isNull(cataloguesTable.deletedAt),
    ...conditions,
    or(
      eq(cataloguesTable.userId, userId),
      eq(catalogueCollaboratorsTable.userId, userId),
    ),
  );
