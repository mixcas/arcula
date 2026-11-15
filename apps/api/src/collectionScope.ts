// The membership scope shared by the reads that ask "which collections may
// this caller read?": the signed-in `/collections` list and the Artist Name
// aggregate. One definition, so the two cannot drift into two answers.

import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import {
  collectionCollaborators as collectionCollaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";

/**
 * The left join to the caller's own collaborator row. `(collectionId, userId)`
 * is unique, so the join finds at most one row; an owner is not in this table,
 * so their join finds nothing and the owner column decides the role.
 */
export const collaboratorJoin = (userId: string): SQL | undefined =>
  and(
    eq(collectionCollaboratorsTable.collectionId, collectionsTable.id),
    eq(collectionCollaboratorsTable.userId, userId),
  );

/**
 * The live collections the caller owns or collaborates on, optionally narrowed
 * by the reading query's own conditions — the Artist Name aggregate adds the
 * live-works filter. `deletedAt` is the whole deletion record, so a deleted
 * collection is in neither branch.
 */
export const readableCollectionsWhere = (
  userId: string,
  ...conditions: (SQL | undefined)[]
): SQL | undefined =>
  and(
    isNull(collectionsTable.deletedAt),
    ...conditions,
    or(
      eq(collectionsTable.userId, userId),
      eq(collectionCollaboratorsTable.userId, userId),
    ),
  );
