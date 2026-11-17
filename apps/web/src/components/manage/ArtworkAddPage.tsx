import React, { useEffect, useState } from "react";
import { Alert, Loader, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { schemaResolver } from "@mantine/form";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { useArtworkPhotos } from "@/hooks/useArtworkPhotos";
import { useArtworkDocuments } from "@/hooks/useArtworkDocuments";
import { useArtistNames } from "@/hooks/useArtistNames";
import { artworkService } from "@/services/artworkService";
import { catalogueService } from "@/services/catalogueService";
import { availabilityFor, catalogueSurface } from "@/catalogueSurface";
import { withoutAvailability } from "@/schemas/artwork";
import { ApiRequestError } from "@/services/api";
import { trackEvent } from "@/telemetry/logRocket";
import ArtworkFields from "@/components/manage/artwork/ArtworkFields";
import FormActionsBar, {
  BAR_HEIGHT,
} from "@/components/manage/artwork/FormActionsBar";

import {
  EMPTY_ARTWORK_FORM,
  artworkSchema,
  toArtworkPayload,
  toArtworkCreatePayload,
  type ArtworkFormValues,
  type ArtworkPayload,
  type Catalogue,
} from "@arcula/shared";
import {
  artworkSlug,
  artworkSearchSuffix,
  mintId,
  parseId,
} from "@arcula/shared";

/**
 * The Add page is a single write: the form fields, the client-minted artwork
 * id, and the staged photo/document entries go up in one POST, and the API
 * promotes the staged objects into rows in the same transaction as the
 * fields. There is no partial save: the transaction either lands or it does
 * not.
 */
const ArtworkAddPage: React.FC = () => {
  const { catalogueId: param } = useParams<{ catalogueId: string }>();
  // The route carries "{slug}-{id}"; the API needs the bare id.
  const catalogueId = parseId(param ?? "");
  const navigate = useNavigate();
  // Add is reached from a search result set; the query travels with the page
  // so the back control returns to it and the new work's Edit page keeps it.
  // Built from `q` alone — no other parameter belongs on either destination.
  const [searchParams] = useSearchParams();
  const search = (searchParams.get("q") ?? "").trim();
  const searchSuffix = artworkSearchSuffix(search);

  // The artwork id comes from the shared mint — the same one the API uses for
  // its rows — so the browser and the server cannot drift on the shape. The
  // staged entries are PUT under it while the form is open, and the save
  // creates the row with it: one id, decided once, so staging and the row can
  // never name different artworks. It is hyphen-free, which the edit link
  // `{title}-{id}` depends on: the route cuts at the last hyphen.
  const [artworkId] = useState(() => mintId());

  const form = useForm<ArtworkFormValues, ArtworkPayload>({
    mode: "uncontrolled",
    initialValues: EMPTY_ARTWORK_FORM,
    validateInputOnBlur: true,
    // zod's standard-schema validate is synchronous, so `sync: true` keeps
    // form.validate() synchronous instead of resolving a promise per check.
    validate: schemaResolver(artworkSchema, { sync: true }),
    // The schema's output *is* the payload, so there is no second conversion
    // step: what reaches onSubmit is already trimmed, coerced and stripped of
    // blank fields.
    transformValues: toArtworkPayload,
  });

  const [error, setError] = useState<string | null>(null);
  // Photos and documents live outside the form entirely — see useArtworkPhotos
  // for why a File cannot survive `useForm` in uncontrolled mode. Staging
  // happens at add time, under the catalogue the route names.
  const photos = useArtworkPhotos({ catalogueId, artworkId });
  const documents = useArtworkDocuments({ catalogueId, artworkId });
  const artistNames = useArtistNames();

  // The catalogue's kind is what decides whether this work carries a market
  // state at all, and which states the form offers. The page loads it before
  // showing the form, so the control is either present from the first paint or
  // absent — never a flicker.
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const availabilityValues = catalogue
    ? catalogueSurface(catalogue.kind).availabilityValues
    : [];
  const availabilityInPlay = availabilityValues.length > 0;
  // Destructured so the effect depends on the stable callback rather than on
  // the `form` object, which is rebuilt every render.
  const { initialize } = form;

  useEffect(() => {
    if (!catalogueId) return;

    const fetchCatalogue = async () => {
      try {
        const fetched = await catalogueService.getCatalogue(catalogueId);
        if (!fetched) {
          setLoadError("Catalogue not found");
          return;
        }
        setCatalogue(fetched);
        // A newly surfaced work starts Available: on the kinds that sell
        // work, a work with no market state is the exception, not the default.
        // A kind with no market state is handed nothing. Edits never come
        // through here — this form is the empty one.
        const availability = availabilityFor(fetched.kind, null);
        if (availability !== null) {
          initialize({ ...EMPTY_ARTWORK_FORM, availability });
        }
      } catch (err) {
        console.error("Error fetching catalogue:", err);
        setLoadError("Failed to load the catalogue. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    void fetchCatalogue();
  }, [catalogueId, initialize]);

  if (!catalogueId) {
    return <Alert color="red">Invalid catalogue id</Alert>;
  }

  if (loading) {
    return <Loader />;
  }

  if (loadError) {
    return <Alert color="red">{loadError}</Alert>;
  }

  return (
    <>
      <Text size="h2" mb="xl">
        Add New Artwork
      </Text>

      <form
        // Room for the fixed action bar. Without it the bar sits permanently on
        // top of `currentValue` and the error alerts, which is exactly the
        // content a user most needs to read after a failure.
        style={{ paddingBottom: BAR_HEIGHT + 24 }}
        // Uncontrolled mode repaints a field by remounting it, which is what
        // form.key is for. It is a function of the field path, not a value.
        onSubmit={form.onSubmit(async (payload) => {
          setError(null);

          try {
            // One write: the fields plus the staged entries, promoted in the
            // same transaction. `commit()` answers null when the list is
            // unchanged, which on a new artwork means "nothing staged".
            const body = toArtworkCreatePayload(
              // A Collection has no market state, so its save says nothing
              // about one; the API writes null for the absent key.
              availabilityInPlay ? payload : withoutAvailability(payload),
              artworkId,
              photos.commit() ?? [],
              documents.commit() ?? [],
            );
            const created = await artworkService.createArtwork(
              catalogueId,
              body,
            );
            trackEvent("artwork_created", { catalogue_id: catalogueId });
            notifications.show({
              title: "Artwork created",
              message: `"${created.title}" was added to this catalogue.`,
            });
            void navigate(
              `/manage/catalogue/${param ?? ""}/artwork/${artworkSlug(
                created.title,
                created.id,
              )}${searchSuffix}`,
            );
          } catch (err) {
            console.error("Error creating artwork:", err);
            // A cap hit carries the server's own message ("at most N …"),
            // which is the one to show; everything else stays generic so the
            // alert does not leak a status line.
            setError(
              err instanceof ApiRequestError &&
                err.status === 409 &&
                err.code === "limit-reached"
                ? err.message
                : "Failed to create artwork. Please try again.",
            );
          }
        })}
      >
        <ArtworkFields
          form={form}
          photos={photos}
          documents={documents}
          artistNames={artistNames}
          availabilityValues={availabilityValues}
        />

        {error ? (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        ) : null}

        {/*
          Inside the form, so Save is a real submit control: keyboard
          submission, form validation and the `loading` state all work as they
          did when the buttons were an inline Group.
        */}
        <FormActionsBar
          submitLabel="Save Artwork"
          submitting={form.submitting}
          backTo={`/manage/catalogue/${param ?? ""}${searchSuffix}`}
          backLabel={`Back to ${catalogue?.name ?? "catalogue"}`}
        />
      </form>
    </>
  );
};

export default ArtworkAddPage;
