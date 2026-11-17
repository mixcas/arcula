// The refusal a save earns when it names an Artwork field its Catalogue turned
// off.
//
// One helper, called by the create and the update route after parsing and
// before any write, so a stale form — left open while the setting changed —
// gets one stable answer instead of storing a field the record no longer has.
// `field-disabled` is its own code, not `field-not-writable`: the remedy
// differs. A stale form must re-read the Catalogue, not stop sending a
// server-managed field.
//
// The field names ride in the envelope's structured slot, `error.fields`, as
// the validation refusal carries its failed fields, and the prose names them
// too, because a human reads the message before the client reacts to the code.

import {
  ARTWORK_FIELD_LABELS,
  disabledArtworkFieldsIn,
  resolveArtworkFields,
  type ArtworkFieldKey,
} from "@arcula/shared";
import { ApiError } from "./errors";
import type { CatalogueRow } from "./serialize";

/** "Provenance", "Medium and Provenance", "Medium, Provenance and Notes". */
const proseNames = (fields: readonly ArtworkFieldKey[]): string => {
  const labels = fields.map((field) => ARTWORK_FIELD_LABELS[field]);
  if (labels.length === 1) {
    return labels[0];
  }
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
};

/**
 * Refuses a payload that names any field the Catalogue does not record.
 *
 * The enabled set is the Catalogue's own resolution — its stored deviations
 * laid over its Kind's defaults — and `disabledArtworkFieldsIn` derives the
 * named fields from the shared registry, so the check covers every togglable
 * field rather than a list kept in step by hand. Called after parsing (the
 * payload must be the one the schema produces) and before the transaction
 * opens, so a refused save cannot move a row.
 */
export function assertArtworkFieldsEnabled(
  catalogue: CatalogueRow,
  payload: Partial<Record<ArtworkFieldKey, unknown>>,
): void {
  const { enabled } = resolveArtworkFields(
    catalogue.kind,
    catalogue.artworkFields,
  );
  const disabled = disabledArtworkFieldsIn(enabled, payload);
  if (disabled.length === 0) {
    return;
  }
  const verb = disabled.length === 1 ? "is" : "are";
  throw new ApiError(
    "field-disabled",
    `${proseNames(disabled)} ${verb} not recorded in this catalogue.`,
    {
      fields: Object.fromEntries(
        disabled.map((field) => [
          field,
          `${ARTWORK_FIELD_LABELS[field]} is not recorded in this catalogue.`,
        ]),
      ),
    },
  );
}
