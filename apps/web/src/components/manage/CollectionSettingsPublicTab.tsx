/**
 * The settings page's Public view tab: the skin and the options the selected
 * skin declares.
 *
 * Its Save writes only this tab's half of the PATCH: the skin when it differs
 * from the loaded skin, the option bag when any value in it differs. The tab
 * is clean — Save disabled — exactly when `resolvePublicSave` answers an empty
 * payload, the same answer that becomes the wire body.
 *
 * The loaded side arrives resolved — the skin through the registry and the bag
 * against it, with the keys the loaded skin no longer declares already dropped
 * (the count of which is `staleOptionCount`, reported by the notice below the
 * controls rather than silently lost). Switching skins resets the bag to the
 * new skin's defaults: carrying the old skin's values across would write keys
 * the new skin does not declare.
 */

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { SKINS, resolveSkin, resolveSkinOptions } from "@/skins/registry";
import type { SkinOptionValue } from "@/skins/types";
import {
  resolvePublicSave,
  type PublicEditedValues,
} from "./collectionSettingsSave";

interface PublicTabProps {
  /** The skin the loaded document resolves to — the tab's "loaded" side. */
  skin: string;
  /** The loaded option bag, resolved against the loaded skin. */
  skinOptions: Record<string, SkinOptionValue>;
  /** How many stored option keys the loaded skin does not declare. */
  staleOptionCount: number;
  saving: boolean;
  /** The page's save: it re-derives the payload and posts it. */
  onSave: (edited: PublicEditedValues) => void | Promise<void>;
}

const PublicTab: React.FC<PublicTabProps> = ({
  skin: loadedSkinId,
  skinOptions: loadedOptions,
  staleOptionCount,
  saving,
  onSave,
}) => {
  const [skin, setSkin] = useState(loadedSkinId);
  const [skinOptions, setSkinOptions] =
    useState<Record<string, SkinOptionValue>>(loadedOptions);

  const edited: PublicEditedValues = { skin, skinOptions };

  // The same answer that becomes the wire body: clean — Save stays off —
  // exactly when it is an empty payload.
  const payload = resolvePublicSave(
    { skin: loadedSkinId, skinOptions: loadedOptions },
    edited,
  );
  const clean = Object.keys(payload).length === 0;

  return (
    <Card shadow="sm" p="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(edited);
        }}
      >
        <Select
          label="Skin"
          description="How this collection's public pages are laid out and styled."
          data={SKINS.map((entry) => ({
            value: entry.id,
            label: entry.label,
          }))}
          value={skin}
          allowDeselect={false}
          onChange={(value) => {
            if (!value || value === skin) {
              return;
            }
            // Switching skins resets the options to the new skin's defaults.
            // Carrying the old skin's values across would write keys the new
            // skin does not declare — which `resolveSkinOptions` would then
            // drop again, reporting them as stale.
            const next = resolveSkin(value);
            setSkin(next.id);
            setSkinOptions(resolveSkinOptions(next, undefined).options);
          }}
          mb="md"
        />

        {/*
          The controls are generated from the selected skin's own option
          vocabulary rather than hand-written per skin, which is why adding a
          skin needs no change to this page. A skin with no options renders
          nothing here.
        */}
        {resolveSkin(skin).options.map((spec) =>
          spec.kind === "boolean" ? (
            <Group key={spec.key} justify="space-between" mb="md">
              <Box>
                <Text>{spec.label}</Text>
                {spec.description ? (
                  <Text size="sm" c="dimmed">
                    {spec.description}
                  </Text>
                ) : null}
              </Box>
              <Switch
                checked={skinOptions[spec.key] === true}
                onChange={(e) =>
                  setSkinOptions((current) => ({
                    ...current,
                    [spec.key]: e.currentTarget.checked,
                  }))
                }
                aria-label={spec.label}
              />
            </Group>
          ) : spec.kind === "number" ? (
            <NumberInput
              key={spec.key}
              label={spec.label}
              description={spec.description}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={Number(skinOptions[spec.key] ?? spec.default)}
              onChange={(value) =>
                setSkinOptions((current) => ({
                  ...current,
                  [spec.key]: typeof value === "number" ? value : spec.default,
                }))
              }
              mb="md"
            />
          ) : (
            <TextInput
              key={spec.key}
              label={spec.label}
              description={spec.description}
              value={String(skinOptions[spec.key] ?? spec.default)}
              onChange={(e) =>
                setSkinOptions((current) => ({
                  ...current,
                  [spec.key]: e.currentTarget.value,
                }))
              }
              mb="md"
            />
          ),
        )}

        {staleOptionCount > 0 ? (
          <Alert color="yellow" mb="md" title="Unused options">
            {staleOptionCount === 1
              ? "One saved option is not used by this skin and will be dropped when you save."
              : `${staleOptionCount} saved options are not used by this skin and will be dropped when you save.`}
          </Alert>
        ) : null}

        <Group justify="center" mt="xl">
          <Button type="submit" loading={saving} disabled={clean}>
            Save
          </Button>
        </Group>
      </form>
    </Card>
  );
};

export default PublicTab;
