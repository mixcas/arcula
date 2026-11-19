// The member routes of a Selection:
//
//   GET    /catalogues/{cid}/selections                 the Catalogue's list
//   POST   /catalogues/{cid}/selections                 create
//   GET    /catalogues/{cid}/selections/{sid}           one Selection
//   PATCH  /catalogues/{cid}/selections/{sid}           rename / describe
//   DELETE /catalogues/{cid}/selections/{sid}           delete
//
// Every route is behind the session and then membership of the source
// Catalogue — owner or collaborator, as everywhere a write lives (ADR-0004).
// A stranger gets the same not-found as a Selection that is not there, and the
// check runs before a PATCH body is parsed, so a non-member's malformed body is
// the refusal rather than a validation error.
//
// This slice is member-only: the public reads, unlock and the works payload
// arrive in later slices, flat under `/selections/{sid}`.

import { Hono } from "hono";
import {
  selectionCreateSchema,
  selectionUpdateSchema,
  type SelectionCreatePayload,
  type SelectionUpdatePayload,
} from "@arcula/shared";
import {
  memberCatalogueForSelection,
  requireMemberSelection,
} from "../authorize";
import { param, parseBody } from "../http";
import { readSelection, readSelectionPage } from "../selectionRead";
import {
  createSelection,
  deleteSelection,
  writeSelection,
} from "../selectionWrite";
import { requireSession } from "../session";

export const selectionRoutes = new Hono();

// GET …/selections — the Catalogue's live Selections, name-ordered, each with
// its live-work count and last change. The envelope is an object so a page
// fact can join it later; the route answers every member of the Catalogue.
selectionRoutes.get(
  "/catalogues/:catalogueId/selections",
  requireSession,
  async (c) => {
    const catalogueId = param(c, "catalogueId");
    await memberCatalogueForSelection(c.get("user").id, catalogueId);
    return c.json({ selections: await readSelectionPage(catalogueId) });
  },
);

// POST …/selections — create. The write core asks the membership verdict and
// mints the id; the schema has already trimmed the name and turned a blank
// description into "nothing".
selectionRoutes.post(
  "/catalogues/:catalogueId/selections",
  requireSession,
  async (c) => {
    const payload: SelectionCreatePayload = await parseBody(
      c,
      selectionCreateSchema,
    );
    return c.json(
      await createSelection(c.get("user").id, param(c, "catalogueId"), payload),
      201,
    );
  },
);

// GET …/selections/{sid} — the member read. The row is the one the membership
// verdict just loaded, so the read emits it rather than asking again.
selectionRoutes.get(
  "/catalogues/:catalogueId/selections/:selectionId",
  requireSession,
  async (c) => {
    const { selection } = await requireMemberSelection(
      c,
      param(c, "catalogueId"),
      param(c, "selectionId"),
    );
    return c.json(readSelection(selection));
  },
);

// PATCH …/selections/{sid} — rename and describe. The membership check is
// first, before the body is parsed, as the Catalogue's settings route does.
selectionRoutes.patch(
  "/catalogues/:catalogueId/selections/:selectionId",
  requireSession,
  async (c) => {
    const { selection } = await requireMemberSelection(
      c,
      param(c, "catalogueId"),
      param(c, "selectionId"),
    );
    const payload: SelectionUpdatePayload = await parseBody(
      c,
      selectionUpdateSchema,
    );
    return c.json(await writeSelection(selection, payload));
  },
);

// DELETE …/selections/{sid} — stamp the Selection and close its grants. The
// works, their photos and the Catalogue stay.
selectionRoutes.delete(
  "/catalogues/:catalogueId/selections/:selectionId",
  requireSession,
  async (c) => {
    await deleteSelection(
      c.get("user").id,
      param(c, "catalogueId"),
      param(c, "selectionId"),
    );
    return c.body(null, 204);
  },
);
