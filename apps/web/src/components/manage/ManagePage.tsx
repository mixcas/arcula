import React, { useState, useEffect } from "react";
import { Text, Button, Group, Card, Loader, Badge } from "@mantine/core";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { catalogueService } from "@/services/catalogueService";
import { catalogueLimitForTier, catalogueSlug } from "@arcula/shared";
import type { Catalogue } from "@arcula/shared";
import { catalogueSurface } from "@/catalogueSurface";
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
        setError("Failed to fetch catalogues");
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
        <Text size="h1">My Catalogues</Text>
        <Group gap="sm">
          <Text size="sm" c="dim">
            {owned.length} of {limit} catalogue
            {limit === 1 ? "" : "s"}
          </Text>
          {atCap ? (
            // A disabled button, not a disabled link: an anchor's
            // `disabled` is not an attribute, so a `component={Link}`
            // button at the cap would still navigate to a form the server
            // refuses. A real disabled control cannot, and it is the one
            // that reads as "not offered".
            <Button variant="outline" disabled>
              New catalogue
            </Button>
          ) : (
            <Button
              component={Link}
              to="/manage/catalogue/new"
              variant="outline"
            >
              New catalogue
            </Button>
          )}
        </Group>
      </Group>

      {catalogues.length === 0 ? (
        <Text>No catalogues yet. Create your first catalogue!</Text>
      ) : (
        <div>
          {catalogues.map((catalogue) => (
            <Card key={catalogue.id} shadow="sm" p="lg" mb="md">
              <Group>
                <Text size="h3">{catalogue.name}</Text>
                {/* The kind is named on every row, owned or shared: a reader
                    must know whether this is a Portfolio, a Collection or an
                    Inventory before opening it. */}
                <Badge variant="light">
                  {catalogueSurface(catalogue.kind).kindLabel}
                </Badge>
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
