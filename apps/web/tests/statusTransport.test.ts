// @vitest-environment jsdom
//
// The status, end to end against the real stack: the form's own payload goes
// up, and the document the API answers is read back through the web's own
// service. Every other web suite stubs the service, and the shared suite pins
// the wire schema on a hand-written document — so this is the one place the
// two halves meet, and the only one that would notice the API and the web
// disagreeing about what a saved artwork says.
//
// jsdom, not node: the services are written against the app origin, and the
// session transport (tests/helpers/stackFetch.ts) re-hosts app-origin traffic
// onto the API from jsdom's http://localhost:3000.
//
// The account and collection are run-scoped: the test database persists across
// runs, and email is unique.
import { describe, expect, it } from "vitest";
import {
  EMPTY_ARTWORK_FORM,
  toArtworkCreatePayload,
  toArtworkPayload,
  type ArtworkFormValues,
} from "@arcula/shared";
import { authClient } from "@/auth/client";
import { artworkService } from "@/services/artworkService";
import { collectionService } from "@/services/collectionService";

/** A form the way the Add page submits it, with the status the owner chose. */
const save = async (
  collectionId: string,
  title: string,
  status: ArtworkFormValues["status"],
) => {
  const values: ArtworkFormValues = {
    ...EMPTY_ARTWORK_FORM,
    title,
    artistName: "María López",
    status,
  };
  // The page's own two steps: the schema first, then the create envelope.
  return artworkService.createArtwork(
    collectionId,
    toArtworkCreatePayload(toArtworkPayload(values), `w${Date.now()}`, [], []),
  );
};

describe("the status against the real stack", () => {
  const stamp = Math.random().toString(36).slice(2, 10);
  const email = `status-${stamp}@arcula.test`;
  const password = "[REDACTED_SECRET_4_e8c2f7a1]";

  it("round-trips a draft and a published work through the web's own reads", async () => {
    await authClient.signUp.email({ name: "Status", email, password });
    await authClient.signIn.email({ email, password });

    const collection = await collectionService.createCollection({
      name: `Status wall ${stamp}`,
    });
    const draft = await save(collection.id, `Draft ${stamp}`, "draft");
    const published = await save(
      collection.id,
      `Published ${stamp}`,
      "published",
    );

    // What the owner's page reads — the list, and one work by id.
    const listed = await artworkService.getCollectionArtworks(collection.id);
    const byId = (id: string) => listed.find((row) => row.id === id)?.status;
    expect(byId(draft.id)).toBe("draft");
    expect(byId(published.id)).toBe("published");
    expect(
      (await artworkService.getArtwork(collection.id, draft.id))?.status,
    ).toBe("draft");

    // And the visitor's list of the same public collection: the draft is
    // absent, the published work is not.
    await authClient.signOut();
    const visitor = await artworkService.getCollectionArtworks(collection.id);
    expect(visitor.map((row) => row.id)).toEqual([published.id]);

    // The single read of the draft is the API's uniform 404, which the service
    // folds to null — the public artwork page's not-found state, unchanged.
    expect(await artworkService.getArtwork(collection.id, draft.id)).toBeNull();
  }, 30000);
});
