/**
 * Creating a catalogue: the kind is asked with three cards, and the form asks
 * nothing else until it has an answer.
 *
 * Each card is a native radio inside its label, so arrow keys, Space, form
 * semantics and the accessible name come from the platform rather than from a
 * `Select`. The card carries its kind's colour in both states — the colour is
 * the code the rest of the app uses for the kind, and the picker is where the
 * reader learns it.
 *
 * Nothing is preselected, so the name and description fields (labelled by the
 * chosen kind's surface) and the kind itself arrive only once the reader has
 * chosen. Create stays disabled until then.
 */

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  rem,
  SimpleGrid,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useNavigate } from "react-router-dom";
import {
  CheckIcon,
  PaletteIcon,
  PresentationIcon,
  RugIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useAuth } from "@/hooks/useAuth";
import { catalogueSlug, type CatalogueKind } from "@arcula/shared";
import {
  CATALOGUE_KINDS,
  catalogueSurface,
  kindColorVar,
} from "@/catalogueSurface";
import { catalogueService } from "@/services/catalogueService";
import { ApiRequestError } from "@/services/api";

/**
 * What the person making the catalogue calls themselves, so a card reads
 * "Artist" above "Portfolio". The personas are a picker fact, not a surface
 * one: no other screen names the reader.
 */
const KIND_PERSONAS: Record<CatalogueKind, string> = {
  portfolio: "Artist",
  inventory: "Gallery",
  collection: "Art Collector",
};

/**
 * The kind's glyph. It lives here rather than in `catalogueSurface` because
 * that module is pure data and may not hold React components; this picker is
 * the icons' only consumer until a second screen needs them.
 */
const KIND_ICONS: Record<CatalogueKind, Icon> = {
  portfolio: PaletteIcon,
  inventory: PresentationIcon,
  collection: RugIcon,
};

interface KindCardProps {
  kind: CatalogueKind;
  selected: boolean;
  onSelect: (kind: CatalogueKind) => void;
}

const KindCard: React.FC<KindCardProps> = ({ kind, selected, onSelect }) => {
  const { kindLabel, kindColor } = catalogueSurface(kind);
  const Icon = KIND_ICONS[kind];
  const fill = kindColorVar(kindColor, 3);
  const glyph = kindColorVar(kindColor, 7);

  return (
    <Box
      component="label"
      bg={selected ? fill : "var(--mantine-color-body)"}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--mantine-spacing-xs)",
        minHeight: rem(160),
        padding: "var(--mantine-spacing-xl) var(--mantine-spacing-lg)",
        border: `${selected ? 2 : 1}px solid ${selected ? glyph : fill}`,
        cursor: "pointer",
      }}
    >
      {/* The input covers the card, and the browser paints its focus ring
          around that box — so the ring lands on the card. The control itself
          is made invisible by styling (no appearance, no background, no
          border, no padding) rather than by `opacity: 0`, which would fade the
          ring with it; clipping it would hide the ring too. */}
      <input
        type="radio"
        name="kind"
        value={kind}
        checked={selected}
        onChange={() => onSelect(kind)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          margin: 0,
          padding: 0,
          appearance: "none",
          background: "transparent",
          border: 0,
          cursor: "pointer",
        }}
      />
      {selected && (
        <CheckIcon
          size={18}
          weight="bold"
          color="var(--mantine-color-dark-9)"
          aria-hidden
          style={{
            position: "absolute",
            top: "var(--mantine-spacing-xs)",
            right: "var(--mantine-spacing-xs)",
          }}
        />
      )}
      <Icon
        size={32}
        weight="regular"
        color={selected ? "var(--mantine-color-dark-9)" : glyph}
        aria-hidden
      />
      <Text size="sm" c={selected ? "dark.9" : "dimmed"}>
        {KIND_PERSONAS[kind]}
      </Text>
      <Text fw={600} c={selected ? "dark.9" : undefined}>
        {kindLabel}
      </Text>
    </Box>
  );
};

const NewCataloguePage: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [kind, setKind] = useState<CatalogueKind | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The words the form asks with follow the kind: an artist is asked for their
  // name and bio, a gallery for its name and about, a collector for the
  // catalogue's name and description. No kind yet means no fields to label.
  const surface = kind === null ? null : catalogueSurface(kind);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser) {
      setError("User not authenticated");
      return;
    }

    // Create is disabled until a kind is chosen; the guard is here so a
    // future caller of `handleSubmit` cannot send a catalogue without one.
    if (kind === null) return;
    const chosen = catalogueSurface(kind);

    if (!name.trim()) {
      setError(`${chosen.nameLabel} is required`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // The answer is the created catalogue — id, name and all — so the
      // redirect slugs from the server's record rather than the form's.
      const created = await catalogueService.createCatalogue({
        name: name.trim(),
        kind,
        description: description.trim(),
      });

      // Redirect to the newly created catalogue page
      void navigate(
        `/manage/catalogue/${catalogueSlug(created.name, created.id)}`,
      );
    } catch (err) {
      console.error("Error creating catalogue:", err);
      // Hitting the tier cap is the one failure with a message worth showing
      // as-is ("You can have at most N catalogues on the free tier"); every
      // other error stays generic.
      setError(
        err instanceof ApiRequestError &&
          err.status === 409 &&
          err.code === "limit-reached"
          ? err.message
          : "Failed to create catalogue. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <Box
          component="fieldset"
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <Text component="legend" fw={500} mb="sm" p={0}>
            What kind of catalogue are you making?
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            {CATALOGUE_KINDS.map((value) => (
              <KindCard
                key={value}
                kind={value}
                selected={kind === value}
                onSelect={setKind}
              />
            ))}
          </SimpleGrid>
        </Box>

        {surface !== null && (
          <>
            <TextInput
              label={surface.nameLabel}
              placeholder={`Enter ${surface.nameLabel.toLowerCase()}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              mt="xl"
              mb="md"
            />

            <Textarea
              label={surface.descriptionLabel}
              placeholder={`Enter ${surface.descriptionLabel.toLowerCase()} (optional)`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              mb="md"
            />
          </>
        )}

        <Group mt="md">
          <Button type="submit" disabled={loading || kind === null}>
            {loading ? <Loader size="sm" /> : "Create Catalogue"}
          </Button>
        </Group>
      </form>
    </>
  );
};

export default NewCataloguePage;
