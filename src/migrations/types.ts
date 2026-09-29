import type { Firestore } from "firebase/firestore";

/**
 * A one-off, repeatable data migration.
 *
 * Firestore has no schema and therefore nothing that could enforce one for
 * you: a field added to a document type only exists on documents written
 * *after* it was added, and everything written before is silently a different
 * shape. Nothing complains — a query on the new field just returns fewer rows
 * than you expect. This type is the app's answer: a named, ordered,
 * re-runnable step that brings old documents up to the current shape.
 *
 * Every migration takes the `Firestore` instance as an argument rather than
 * importing the app's own, so the rules suite can point it at the emulator.
 */
export interface Migration {
  /** Stable, dated identifier. Never reused or renumbered. */
  id: string;
  /** Short imperative label, e.g. "Add deletedAt to existing artworks". */
  label: string;
  /** What breaks without this, in one or two sentences. */
  description: string;
  /**
   * How many documents would change right now. Drives the "nothing to do"
   * state, so a migration that has already run costs one cheap read.
   *
   * This is deliberately a *content* check and not a "has run" marker: the
   * data itself says whether it is current, so there is no bookkeeping to keep
   * in sync and no second place for the truth to be wrong.
   */
  countPending: (db: Firestore, userId: string) => Promise<number>;
  /**
   * Apply the migration. Must be idempotent — running it twice, or on a
   * partially migrated collection, must be safe and must converge.
   */
  run: (db: Firestore, userId: string) => Promise<{ updated: number }>;
}
