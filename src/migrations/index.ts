import { backfillArtworkDeletedAt } from "./backfillArtworkDeletedAt";
import type { Migration } from "./types";

export type { Migration } from "./types";

/**
 * The migration registry, oldest first.
 *
 * Add new migrations to the end and never renumber or reorder an existing
 * entry: a migration is identified by its `id`, and the order here is the
 * order they are offered in. Each one only has to bring its own field up to
 * date, so they do not strictly depend on each other — but running them in
 * order is what you get, and a later migration may well assume an earlier
 * one already ran.
 */
export const migrations: readonly Migration[] = [backfillArtworkDeletedAt];
