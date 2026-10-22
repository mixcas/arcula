import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Loader, Text } from "@mantine/core";
import { useForm, schemaResolver } from "@mantine/form";
import { useNavigate, useParams } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { useArtworkPhotos } from "@/hooks/useArtworkPhotos";
import { useArtworkDocuments } from "@/hooks/useArtworkDocuments";
import { artworkService } from "@/services/artworkService";
import { ApiRequestError } from "@/services/api";
import ArtworkFields from "@/components/manage/artwork/ArtworkFields";
import FormActionsBar, {
  BAR_HEIGHT,
} from "@/components/manage/artwork/FormActionsBar";

import {
  EMPTY_ARTWORK_FORM,
  artworkSchema,
  fromArtwork,
  toArtworkPayload,
  type ArtworkFormValues,
  type ArtworkPayload,
} from "@arcula/shared";
import { toArtworkUpdate } from "@/schemas/artwork";
import { artworkSlug, parseId } from "@arcula/shared";

/**
 * The Edit save is one PATCH. The text fields come from `toArtworkUpdate`,
 * which decides per field between "set", "clear" (`null`) and "leave alone"
 * (absent) against the loaded values; the photo and document sequences are
 * attached only when their `commit()` says they changed — an absent key
 * leaves the stored sequence alone, which is what keeps a title-only save
 * from renumbering fifty rows.
 */
const ArtworkEditPage: React.FC = () => {
  const { collectionId: collectionParam, artworkId: artworkParam } = useParams<{
    collectionId: string;
    artworkId: string;
  }>();
  // Either segment may be a bare id or a "{slug}-{id}" param; the API needs the
  // bare ids.
  const collectionId = parseId(collectionParam ?? "");
  const artworkId = parseId(artworkParam ?? "");
  const navigate = useNavigate();

  const form = useForm<ArtworkFormValues, ArtworkPayload>({
    mode: "uncontrolled",
    initialValues: EMPTY_ARTWORK_FORM,
    validateInputOnBlur: true,
    validate: schemaResolver(artworkSchema, { sync: true }),
    transformValues: toArtworkPayload,
  });
  // Destructured so the effect depends on the stable callback rather than on
  // the `form` object, which is rebuilt every render.
  const { initialize } = form;

  // Values as loaded from the API. Needed at save time to tell a field the
  // user cleared apart from one that was never set — see toArtworkUpdate.
  // State rather than a ref: the submit handler is built during render, and
  // react-hooks/refs rejects reading a ref there.
  const [loadedValues, setLoadedValues] =
    useState<ArtworkFormValues>(EMPTY_ARTWORK_FORM);

  // The title as loaded, kept apart from the form's own `title` field — that is
  // the editable buffer, and rewriting the URL from it would fire on every
  // keystroke. Null until the fetch succeeds, which is also what stops an
  // artwork that failed to load from being rewritten to a guessed slug.
  const [loadedTitle, setLoadedTitle] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  // Kept separate from `error`: a load failure means there is nothing to edit,
  // but a save failure must leave the user's input on screen.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A deleted work still loads — the read admits a member to a tombstoned work
  // so it can be restored from here. Save stays shut while it is deleted, and
  // Restore clears the state in place rather than navigating: the form below is
  // uncontrolled, so nothing the user typed is lost.
  const [isDeleted, setIsDeleted] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // The synchronous half of the guard below: `restoring` is state, so two
  // clicks dispatched before React re-renders would both read `false`. The ref
  // is what makes the second click a no-op.
  const restoringRef = useRef(false);
  // Kept apart from `error`: a failed restore must not look like a failed save,
  // and it lives inside the banner it failed to dismiss.
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // The hooks stage under the collection and artwork the route names — no load
  // has to complete first, because staging needs neither.
  const photos = useArtworkPhotos({ collectionId, artworkId });
  const documents = useArtworkDocuments({ collectionId, artworkId });
  // Destructured for the same reason as `initialize` above: the load effect must
  // depend on the stable callback, not on a hook result object rebuilt each
  // render.
  const { hydrate: photosHydrate } = photos;
  const { hydrate: documentsHydrate } = documents;

  useEffect(() => {
    if (!collectionId || !artworkId) {
      // The render below shows the invalid-id alert before any of this state,
      // so the guard has nothing to set — only the fetch to skip.
      return;
    }

    const fetchArtwork = async () => {
      try {
        const artwork = await artworkService.getArtwork(
          collectionId,
          artworkId,
        );
        if (!artwork) {
          setLoadError("Artwork not found");
          return;
        }

        const values = fromArtwork(artwork);
        setLoadedValues(values);
        setLoadedTitle(values.title);
        setIsDeleted(artwork.deletedAt != null);
        // The stored photos, hydrated into the working list. This is what makes
        // an existing image re-orderable and removable rather than only
        // appendable.
        photosHydrate(artwork.photos);
        // The same for documents, so an existing one is removable rather than
        // only appendable.
        documentsHydrate(artwork.documents);
        // In uncontrolled mode this bumps the form key, which is what remounts
        // the inputs with the loaded values as their new defaults.
        initialize(values);
      } catch (err) {
        console.error("Error fetching artwork:", err);
        setLoadError("Failed to load artwork. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    void fetchArtwork();
  }, [collectionId, artworkId, initialize, photosHydrate, documentsHydrate]);

  // Put the canonical "{title}-{id}" in the address bar once the title is
  // known, preserving the collection segment exactly as it arrived — this page
  // never loads the collection, so it has no name to re-slug it from.
  // `replace` swaps the current history entry rather than adding one.
  useEffect(() => {
    if (!artworkParam || loadedTitle === null) {
      return;
    }
    const canonical = artworkSlug(loadedTitle, artworkId);
    if (canonical === artworkParam) {
      return;
    }
    void navigate(
      `/manage/collection/${collectionParam}/artwork/${canonical}`,
      {
        replace: true,
      },
    );
  }, [artworkParam, collectionParam, artworkId, loadedTitle, navigate]);

  // One POST, and the page's own state is the whole response: it does not
  // refetch the work (it already holds it), does not re-initialise the form
  // (the unsaved input is the point of restoring here) and does not save.
  const restore = async () => {
    // A click can land while the request is in flight but before the disabled
    // button repaints, so the guard lives in the handler rather than only in
    // the props.
    if (restoringRef.current) return;
    restoringRef.current = true;
    setRestoreError(null);
    setRestoring(true);
    try {
      await artworkService.restoreArtwork(collectionId, artworkId);
      setIsDeleted(false);
    } catch (err) {
      // The banner stays, so the retry is the same button; the failure is
      // shown inside it rather than replacing the deleted state with an error.
      console.error("Error restoring artwork:", err);
      setRestoreError("Failed to restore artwork. Please try again.");
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  };

  if (!artworkId || !collectionId) {
    return <Alert color="red">Invalid artwork id</Alert>;
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
        Edit Artwork
      </Text>
      {isDeleted ? (
        <Alert color="orange" title="This artwork is deleted" mb="md">
          <Text size="sm">
            It is not shown in the collection or on its public page, and Save
            stays off until it is back. Restore it here to keep editing;
            anything you have typed is kept. The Deleted view lists the
            collection&rsquo;s deleted works.
          </Text>
          {restoreError ? (
            <Alert color="red" title="Restore failed" mt="sm">
              {restoreError}
            </Alert>
          ) : null}
          <Button
            mt="md"
            onClick={() => void restore()}
            loading={restoring}
            disabled={restoring}
          >
            Restore
          </Button>
        </Alert>
      ) : null}
      <form
        // Room for the fixed action bar, so the last field and the alerts
        // above are never permanently behind it.
        style={{ paddingBottom: BAR_HEIGHT + 24 }}
        // Uncontrolled mode repaints a field by remounting it, which is what
        // form.key is for. It is a function of the field path, not a value.
        onSubmit={form.onSubmit(async (payload) => {
          // The button is disabled while deleted, but Enter in a field can
          // still submit a form, so the state is enforced here too.
          if (isDeleted) {
            return;
          }
          setError(null);

          try {
            // One PATCH, one transaction on the server: the fields, and the
            // full new sequences whenever they differ from what was loaded.
            const photosCommit = photos.commit();
            const documentsCommit = documents.commit();
            await artworkService.updateArtwork(collectionId, artworkId, {
              ...toArtworkUpdate(loadedValues, payload),
              ...(photosCommit ? { photos: photosCommit } : {}),
              ...(documentsCommit ? { documents: documentsCommit } : {}),
            });
            // No redirect. This form is where a second pass over a long field
            // list is done — leaving would throw away the scroll position on
            // every save. A toast is enough confirmation: the timestamps and
            // the unchanged inputs are both proof it worked.
            notifications.show({
              title: "Artwork saved",
              message: `"${payload.title}" was updated.`,
            });
          } catch (err) {
            console.error("Error updating artwork:", err);
            // A cap hit carries the server's own message ("at most N …"),
            // which is the one to show; everything else stays generic so the
            // alert does not leak a status line.
            setError(
              err instanceof ApiRequestError &&
                err.status === 409 &&
                err.code === "limit-reached"
                ? err.message
                : "Failed to save artwork. Please try again.",
            );
          }
        })}
      >
        <ArtworkFields
          form={form}
          photos={photos}
          documents={documents}
          uploadsDisabled={isDeleted}
        />

        {error ? (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        ) : null}

        {/*
          Inside the form, so Save is still a real submit control and keeps
          keyboard submission, validation and the `loading` state.
        */}
        <FormActionsBar
          submitLabel="Save Changes"
          submitting={form.submitting}
          submitDisabled={isDeleted}
          cancelTo={`/manage/collection/${collectionParam ?? ""}`}
        />
      </form>
    </>
  );
};

export default ArtworkEditPage;
