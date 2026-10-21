import { afterEach, describe, expect, it, vi } from "vitest";
import { invitationService } from "@/services/invitationService";

/**
 * The invitation service's wire half: which URL each operation calls, which
 * shared schema parses the answer, and the one structured refusal the page
 * reads — the invited address on a wrong-account acceptance.
 *
 * The component suite stubs this module and the API suite pins the routes, so
 * this is the seam neither of those owns. The refusal is parsed rather than
 * read defensively: a server that reshapes it must fail here, not render a
 * switch-account state with no address in it.
 */

interface Call {
  url: string;
  init: RequestInit;
}

const answer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const stubFetch = (response: Response): Call[] => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(response);
    }),
  );
  return calls;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOKEN = "tok-not-a-real-token";

const preview = {
  collection: { id: "c1", name: "Flores Solares" },
  inviter: { name: "Sofía Lara" },
  email: "invited@example.test",
  expiresAt: { seconds: 1790000000, nanoseconds: 0 },
};

const collection = {
  id: "c1",
  name: "Flores Solares",
  userId: "u-owner",
  isPublic: false,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

const declined = {
  id: "i1",
  collectionId: "c1",
  email: "invited@example.test",
  invitedByUserId: "u-owner",
  status: "declined",
  createdAt: { seconds: 1, nanoseconds: 0 },
  expiresAt: { seconds: 2, nanoseconds: 0 },
  resolvedAt: { seconds: 3, nanoseconds: 0 },
};

/** One dashboard card's row: the offer plus the two names it renders. */
const inboxEntry = {
  ...declined,
  status: "pending",
  resolvedAt: null,
  collectionName: "Flores Solares",
  inviterName: "Sofía Lara",
};

const wrongAccount = (details?: unknown, status = 403): Response =>
  answer(
    {
      error: {
        code: "forbidden",
        message: "This invitation is for a different email address",
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
  );

describe("getInvitation", () => {
  it("reads the public preview by token and parses the wire document", async () => {
    const calls = stubFetch(answer(preview));

    await expect(invitationService.getInvitation(TOKEN)).resolves.toEqual(
      preview,
    );
    expect(calls[0]?.url).toBe(`/api/v1/invitations/${TOKEN}`);
  });

  it("folds the uniform 404 to null, so the page has one dead-link state", async () => {
    stubFetch(
      answer(
        {
          error: {
            code: "not-found",
            message: "The invitation does not exist",
          },
        },
        404,
      ),
    );

    await expect(invitationService.getInvitation(TOKEN)).resolves.toBeNull();
  });

  it("fails on a reshaped preview instead of rendering it", async () => {
    stubFetch(answer({ ...preview, collection: { id: "c1" } }));

    await expect(invitationService.getInvitation(TOKEN)).rejects.toThrow();
  });
});

describe("acceptInvitation", () => {
  it("posts to the accept route and parses the collection it answers", async () => {
    const calls = stubFetch(answer(collection));

    await expect(invitationService.acceptInvitation(TOKEN)).resolves.toEqual({
      status: "accepted",
      collection,
    });
    expect(calls[0]?.url).toBe(`/api/v1/invitations/${TOKEN}/accept`);
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("carries the invited address out of a wrong-account refusal", async () => {
    stubFetch(wrongAccount({ email: "invited@example.test" }));

    await expect(invitationService.acceptInvitation(TOKEN)).resolves.toEqual({
      status: "wrong-account",
      email: "invited@example.test",
    });
  });

  it("fails loudly when the refusal no longer names the address", async () => {
    // The failure this pins: silently treating a reshaped 403 as
    // "wrong account, whose address we do not know" and rendering a switch
    // state with nothing to show.
    stubFetch(wrongAccount({ address: "invited@example.test" }));

    await expect(invitationService.acceptInvitation(TOKEN)).rejects.toThrow();
  });
});

describe("declineInvitation", () => {
  it("posts to the decline route and parses the resolved row", async () => {
    const calls = stubFetch(answer(declined));

    await expect(invitationService.declineInvitation(TOKEN)).resolves.toEqual(
      declined,
    );
    expect(calls[0]?.url).toBe(`/api/v1/invitations/${TOKEN}/decline`);
    expect(calls[0]?.init.method).toBe("POST");
  });
});

describe("getPendingInvitations", () => {
  it("reads the inbox and parses every entry the card renders", async () => {
    const calls = stubFetch(answer([inboxEntry]));

    await expect(invitationService.getPendingInvitations()).resolves.toEqual([
      inboxEntry,
    ]);
    expect(calls[0]?.url).toBe("/api/v1/me/invitations");
  });

  it("fails on an entry with no inviter name", async () => {
    stubFetch(answer([{ ...inboxEntry, inviterName: undefined }]));

    await expect(invitationService.getPendingInvitations()).rejects.toThrow();
  });
});

describe("declinePendingInvitation", () => {
  it("posts the in-app decline by id and parses the resolved row", async () => {
    const calls = stubFetch(answer(declined));

    await expect(
      invitationService.declinePendingInvitation("i1"),
    ).resolves.toEqual(declined);
    expect(calls[0]?.url).toBe("/api/v1/me/invitations/i1/decline");
    expect(calls[0]?.init.method).toBe("POST");
  });
});

/** One owner-side offer, as the create and resend responses carry it. */
const offer = {
  id: "i1",
  collectionId: "c1",
  email: "invited@example.test",
  invitedByUserId: "u-owner",
  status: "pending",
  createdAt: { seconds: 1, nanoseconds: 0 },
  expiresAt: { seconds: 2, nanoseconds: 0 },
  resolvedAt: null,
};

describe("createInvitation", () => {
  it("posts the address and parses the row plus the mail outcome", async () => {
    const calls = stubFetch(
      answer({ invitation: offer, emailSent: true }, 201),
    );

    await expect(
      invitationService.createInvitation("c1", "invited@example.test"),
    ).resolves.toEqual({ invitation: offer, emailSent: true });
    expect(calls[0]?.url).toBe("/api/v1/collections/c1/invitations");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      email: "invited@example.test",
    });
  });

  it("keeps an unsent mail distinguishable from an invitation failure", async () => {
    stubFetch(answer({ invitation: offer, emailSent: false }, 201));

    await expect(
      invitationService.createInvitation("c1", "invited@example.test"),
    ).resolves.toEqual({ invitation: offer, emailSent: false });
  });
});

describe("resendInvitation", () => {
  it("posts to the resend route and parses the rotated row", async () => {
    const calls = stubFetch(answer({ invitation: offer, emailSent: true }));

    await expect(
      invitationService.resendInvitation("c1", "i1"),
    ).resolves.toEqual({ invitation: offer, emailSent: true });
    expect(calls[0]?.url).toBe("/api/v1/collections/c1/invitations/i1/resend");
    expect(calls[0]?.init.method).toBe("POST");
  });
});

describe("revokeInvitation", () => {
  it("deletes the pending row and parses the revoked one", async () => {
    const revoked = {
      ...offer,
      status: "revoked",
      resolvedAt: { seconds: 3, nanoseconds: 0 },
    };
    const calls = stubFetch(answer(revoked));

    await expect(
      invitationService.revokeInvitation("c1", "i1"),
    ).resolves.toEqual(revoked);
    expect(calls[0]?.url).toBe("/api/v1/collections/c1/invitations/i1");
    expect(calls[0]?.init.method).toBe("DELETE");
  });
});
