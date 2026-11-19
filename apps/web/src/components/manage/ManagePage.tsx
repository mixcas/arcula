import React, { useState, useEffect } from "react";
import {
  Text,
  Button,
  Group,
  Card,
  Loader,
  Badge,
  Paper,
  Stack,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { IconStackPlus } from "@tabler/icons-react";
import { useAuth } from "@/hooks/useAuth";
import { catalogueService } from "@/services/catalogueService";
import { catalogueLimitForTier, catalogueSlug } from "@arcula/shared";
import type { Catalogue } from "@arcula/shared";
import CatalogueKindBadge from "./CatalogueKindBadge";
import PendingInvitations from "./PendingInvitations";

const ManagePage: React.FC = () => {
  const { currentUser, me } = useAuth();
  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Depend on the uid rather than the user object, so the effect re-runs only
  // when the signed-in user changes and `userId` is narrowed to a string.
  const userId = currentUser?.uid;

  useEffect(() => {
    const fetchCatalogues = async () => {
      if (!userId) return;

      try {
        // The session decides whose catalogues these are; the client sends
        // nothing but the path.
        setCatalogues(await catalogueService.getUserCatalogues());
      } catch (err) {
        console.error("Error fetching catalogues:", err);
        setError("Could not load your catalogues");
      } finally {
        setLoading(false);
      }
    };

    void fetchCatalogues();
  }, [userId]);

  if (loading) {
    return (
      <Group justify="center">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Text color="red" ta="center">
        {error}
      </Text>
    );
  }

  // The cap the UI reflects. The limit is read off the session's tier the
  // same way the API reads it on create — one shared function, so the two
  // cannot name the number differently. Enforcement is the API's (409
  // limit-reached); the UI only reflects it, and neither the counter nor
  // the disabled button is a security boundary — they must never be
  // described as one.
  //
  // The count is the catalogues this account OWNS, not the ones it can see:
  // a shared catalogue is not the viewer's to create, and the cap gates
  // creation (ADR-0004). Counting the rows would lock a collaborator out of
  // their first own catalogue.
  const owned = catalogues.filter((c) => c.role === "owner");
  const limit = catalogueLimitForTier(me?.tier);
  const atCap = owned.length >= limit;

  return (
    <>
      {/* Offers addressed to this account sit above the catalogue list: they
          are the one thing on the dashboard that needs an answer. */}
      <PendingInvitations />

      <Group mb="xl" justify="space-between" align="center">
        <Text size="h1">My catalogues</Text>
        <Group gap="sm">
          <Text size="sm" c="dim">
            {owned.length} of {limit} catalogue
            {limit === 1 ? "" : "s"}
          </Text>
          <Button
            disabled={atCap}
            component={atCap ? undefined : Link}
            to="/manage/catalogue/new"
            leftSection={<IconStackPlus size={18} />}
          >
            New catalogue
          </Button>
        </Group>
      </Group>

      {catalogues.length === 0 ? (
        // The empty dashboard is a way forward, not a caption: a collector who
        // owns nothing has one thing to do here, and the header's button alone
        // leaves the empty page looking like the end of the story. The label
        // differs from the header's "New catalogue" so the two never read as
        // the same control to a screen reader.
        <Paper p="xl" ta="center">
          <Stack align="center" gap="sm">
            <Text fw={500}>No catalogues yet</Text>
            <Text size="sm" c="dimmed">
              A catalogue is where your artworks live. Start with one — the rest
              tend to follow.
            </Text>
            <Button
              component={Link}
              to="/manage/catalogue/new"
              leftSection={<IconStackPlus size={18} />}
            >
              Create your first catalogue
            </Button>
          </Stack>
        </Paper>
      ) : (
        <div>
          {catalogues.map((catalogue) => (
            <Card key={catalogue.id} shadow="sm" p="lg" mb="md">
              <Group>
                <Text size="h3">{catalogue.name}</Text>
                {/* The kind is named on every row, owned or shared: a reader
                    must know whether this is a Portfolio, a Collection or an
                    Inventory before opening it, and its colour says so at a
                    glance. */}
                <CatalogueKindBadge kind={catalogue.kind} />
                {/* The role is named, not implied: a shared catalogue sits
                    beside an owned one, and who owns it is the fact the row
                    adds. The owner's name rides the shared row alone. */}
                <Badge variant="light" color="gray">
                  {catalogue.role === "collaborator" ? "Collaborator" : "Owner"}
                </Badge>
                {catalogue.ownerName && (
                  <Text size="sm" c="dim">
                    by {catalogue.ownerName}
                  </Text>
                )}
                <Button
                  component={Link}
                  to={`/manage/catalogue/${catalogueSlug(catalogue.name, catalogue.id)}`}
                >
                  View
                </Button>
              </Group>
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

export default ManagePage;
