/**
 * The Firestore update payloads — the `updateDoc` merge sentinels.
 *
 * Carved out of what used to be `types/index.ts`, and kept next to the
 * service layer that owns Firestore merge semantics rather than in the client
 * contract: `updateDoc` merges, so a key that is simply absent leaves the
 * stored field alone — which would make it impossible to clear a value once
 * it is set. Any field may therefore also carry a `deleteField()` sentinel to
 * remove it. Same mapped-type shape and rationale for both: written as a
 * mapped type rather than `Record<string, unknown>` so the usual type checking
 * survives — a wrong value type or an unknown key is still an error, it just
 * widens to accept the sentinel.
 *
 * Temporary by design: an API PATCH body has no sentinel concept (a cleared
 * field is simply absent, or `null`), so these types and the `FieldValue`
 * import go away in Phase 4 of the migration plan, when the service layer
 * they belong to does.
 */
import type { FieldValue } from "firebase/firestore";
import type { Artwork, Collection } from "@arcula/shared";

export type CollectionUpdate = {
  [K in keyof Omit<Collection, "id">]?: Collection[K] | FieldValue;
};

export type ArtworkUpdate = {
  [K in keyof Omit<Artwork, "id">]?: Artwork[K] | FieldValue;
};
