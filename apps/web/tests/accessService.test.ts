import { afterEach, describe, expect, it, vi } from "vitest";
import { accessService } from "@/services/accessService";

/**
 * The access service's wire half: the read the settings card renders and the
 * two endings, remove and leave. The component suite stubs this module and the
 * API suite pins the routes, so this is the seam neither owns: a path typo or
 * a response the shared schema does not accept fails here.
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

const access = {
  role: "owner",
  owner: {
    userId: "u-owner",
    name: "Sofía Lara",
    email: "owner@example.test",
  },
  collaborators: [
    {
      userId: "u-mate",
      name: "Mateo Ruiz",
      email: "mate@example.test",
    },
  ],
  invitations: [
    {
      id: "i1",
      collectionId: "c1",
      email: "invited@example.test",
      invitedByUserId: "u-owner",
      status: "pending",
      createdAt: { seconds: 1, nanoseconds: 0 },
      expiresAt: { seconds: 2, nanoseconds: 0 },
      resolvedAt: null,
    },
  ],
};

describe("getAccess", () => {
  it("reads the access document and parses every member and invitation", async () => {
    const calls = stubFetch(answer(access));

    await expect(accessService.getAccess("c1")).resolves.toEqual(access);
    expect(calls[0]?.url).toBe("/api/v1/collections/c1/access");
  });

  it("accepts a collaborator's document, whose invitations are absent", async () => {
    const { invitations: _unused, ...collaboratorView } = access;
    stubFetch(answer({ ...collaboratorView, role: "collaborator" }));

    await expect(accessService.getAccess("c1")).resolves.toEqual({
      ...collaboratorView,
      role: "collaborator",
    });
  });

  it("fails on a reshaped member instead of rendering a nameless row", async () => {
    stubFetch(answer({ ...access, collaborators: [{ userId: "u-mate" }] }));

    await expect(accessService.getAccess("c1")).rejects.toThrow();
  });
});

describe("removeCollaborator", () => {
  it("deletes the named membership", async () => {
    const calls = stubFetch(answer({ removed: true }));

    await expect(
      accessService.removeCollaborator("c1", "u-mate"),
    ).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe("/api/v1/collections/c1/collaborators/u-mate");
    expect(calls[0]?.init.method).toBe("DELETE");
  });
});

describe("leaveCollection", () => {
  it("deletes the caller's own membership through /me, never a user id", async () => {
    const calls = stubFetch(answer({ left: true }));

    await expect(accessService.leaveCollection("c1")).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe("/api/v1/collections/c1/collaborators/me");
    expect(calls[0]?.init.method).toBe("DELETE");
  });
});
