import { describe, expect, it } from "vitest";

import { entryPrefix, objectName } from "@/services/artworkFiles";
import { VARIANT_KEYS } from "@/utils/imageVariants";
import { DOCUMENT_EXTENSIONS } from "@/utils/artworkDocuments";

/**
 * The delete sweep, and the prefix it matches on.
 *
 * Deletion works by listing a folder and filtering names by `entryPrefix`, so
 * the whole feature rests on one relationship: **every object an entry could
 * have written starts with its own prefix.** Nothing else checks it. A prefix
 * that stopped matching — a different separator, an id interpolated in a
 * different order — would leave every removed photo's objects in Storage
 * forever, and Storage reports nothing about objects nothing points at.
 *
 * The extension is why the sweep filters rather than reconstructing names: the
 * same photo is `.webp` on a browser with a WebP encoder and `.jpg` on one
 * without, so the set of suffixes is not knowable at delete time. The table below
 * is therefore run over the *cross product* of every key and every extension the
 * app can produce, because a prefix is only right if it is right for all of them
 * at once.
 *
 * Pure by construction: `artworkFiles` builds these names without touching
 * Storage, and only `deleteEntries` does. The sweep's runtime behaviour — that
 * it lists once and deletes only what matches — is covered against the emulator
 * in `storage.rules.test.ts`.
 */

const ARTWORK_ID = "ARTWORK0000000001aa";
const ENTRY_ID = "entry0000000000001aa";

describe("entryPrefix", () => {
  it("prefixes every object the entry could have written", () => {
    // The invariant itself, over every key × extension the app can produce. The
    // assertion is on the *remainder*, not just `startsWith`: a prefix missing
    // its trailing separator still prefixes every name correctly while no longer
    // identifying an entry, and would then match a photo whose id merely starts
    // with this one.
    for (const key of [...VARIANT_KEYS, "original"] as const) {
      for (const extension of DOCUMENT_EXTENSIONS) {
        const name = objectName(ARTWORK_ID, ENTRY_ID, key, extension);
        const prefix = entryPrefix(ARTWORK_ID, ENTRY_ID);
        expect(name.startsWith(prefix), `${name} is not under ${prefix}`).toBe(
          true,
        );
        // What is left after the prefix is exactly the variant and the
        // extension — nothing else may be swallowed into the entry's identity.
        expect(name.slice(prefix.length)).toBe(`${key}.${extension}`);
      }
    }
  });

  it("does not match a different entry's objects", () => {
    // The other half, and the one that decides whether the sweep deletes
    // *something* on the way past: a prefix loose enough to match a sibling
    // would take out a photo that is still on the artwork. Ids are fixed width
    // in practice, so the shared stem is the realistic version of this.
    const mine = entryPrefix(ARTWORK_ID, ENTRY_ID);
    const theirs = objectName(ARTWORK_ID, `${ENTRY_ID}9`, "original", "jpg");

    expect(theirs.startsWith(mine)).toBe(false);
  });

  it("identifies the artwork as well as the entry", () => {
    // Both ids are in the name, which is what makes an object self-describing
    // when read in the console — and what lets the rules bind a name to the path
    // it was written under. A prefix carrying only the entry id would lose the
    // artwork half of that.
    expect(entryPrefix(ARTWORK_ID, ENTRY_ID)).toContain(ARTWORK_ID);
    expect(entryPrefix(ARTWORK_ID, ENTRY_ID)).toContain(ENTRY_ID);
  });
});

describe("objectName", () => {
  it("writes the extension the blob actually had, not the one requested", () => {
    // The name is the only thing `storage.rules` can bind a declared
    // `contentType` to, so the two have to agree — and the extension is a
    // parameter precisely because the same photo is `.webp` on one browser and
    // `.jpg` on one without an encoder for it.
    expect(objectName(ARTWORK_ID, ENTRY_ID, "original", "jpg")).toBe(
      `${ARTWORK_ID}_${ENTRY_ID}_original.jpg`,
    );
    expect(objectName(ARTWORK_ID, ENTRY_ID, "xlarge", "webp")).toBe(
      `${ARTWORK_ID}_${ENTRY_ID}_xlarge.webp`,
    );
  });
});
