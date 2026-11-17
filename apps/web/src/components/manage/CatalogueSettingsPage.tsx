/**
 * The catalogue's settings page: one read, four tabs, one save per tab.
 *
 * The tabs are addresses — `/settings/general`, `/settings/public`,
 * `/settings/access`, `/settings/data` — and a bare or unknown segment
 * canonicalises to `general` through the effect that already rewrites the
 * catalogue's name-and-id in the address, so an old settings link lands on
 * General rather than on a redirect route. The heading sits above the tab
 * list, outside the panels; the panels are not kept mounted, so entering a tab
 * fills it from the values the page last loaded or saved and leaving it drops
 * what was typed — the Access tab consequently fetches nothing until it is
 * reached.
 *
 * Each tab's Save writes only its own half of the PATCH. The decision is the
 * pure fold in `catalogueSettingsSave`, recomputed here on the way to the
 * wire: a save leaves the member on the tab it saved from, re-canonicalises
 * the name in the address in place, and confirms what was saved; a failure
 * uses the same channel and leaves the form as it was.
 */

import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Scroller,
  Tabs,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  catalogueSlug,
  parseId,
  type Catalogue,
  type CatalogueUpdatePayload,
} from "@arcula/shared";
import { catalogueService } from "../../services/catalogueService";
import { trackEvent } from "@/telemetry/logRocket";
import { resolveSkin, resolveSkinOptions } from "@/skins/registry";
import GeneralTab from "./CatalogueSettingsGeneralTab";
import PublicTab from "./CatalogueSettingsPublicTab";
import DataTab from "./CatalogueSettingsDataTab";
import AccessCard from "./catalogue/AccessCard";
import {
  resolveGeneralSave,
  resolvePublicSave,
  type GeneralEditedValues,
  type PublicEditedValues,
} from "./catalogueSettingsSave";

/** The four segments the address may carry; anything else is `general`. */
const SETTINGS_TABS = ["general", "public", "access", "data"] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];

const isSettingsTab = (value: string | undefined): value is SettingsTab =>
  value !== undefined && (SETTINGS_TABS as readonly string[]).includes(value);

const TAB_LABELS: Record<SettingsTab, string> = {
  general: "General",
  public: "Public view",
  access: "Access",
  data: "Data",
};

const CatalogueSettingsPage: React.FC = () => {
  const { catalogueId: param, tab: tabParam } = useParams<{
    catalogueId: string;
    tab?: string;
  }>();
  // Routes carry "{slug}-{id}" but the API needs the id alone.
  const catalogueId = parseId(param ?? "");
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : "general";
  const navigate = useNavigate();

  // The one document the whole page works from: loaded on entry, re-stamped
  // with the server's answer after each save, so a tab re-entered starts from
  // what is actually stored. Null until the load resolves.
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Kept apart: a load failure means the page should not render, but a save
  // failure must leave the user's input on screen — it does, because a failed
  // save neither unmounts the panel nor moves the address.
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalogueId) {
      return;
    }
    let cancelled = false;
    const fetchCatalogue = async () => {
      try {
        const data = await catalogueService.getCatalogue(catalogueId);
        if (cancelled) {
          return;
        }
        if (!data) {
          setLoadError("Catalogue not found");
        } else {
          setCatalogue(data);
          setLoadError(null);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Error fetching catalogue:", err);
        setLoadError("Failed to load catalogue settings. Please try again.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void fetchCatalogue();
    return () => {
      cancelled = true;
    };
  }, [catalogueId]);

  // Put the canonical "{slug}-{id}" in the address bar once the name is known,
  // keeping this page's own /settings/:tab segments. A bare address — and any
  // address the tab segment does not name — is what /settings/general looks
  // like, so the rewrite lands old and mistyped links on General, and a
  // rename re-canonicalises the slug in place. `replace` swaps the current
  // history entry rather than adding one.
  useEffect(() => {
    if (!param || !catalogue) {
      return;
    }
    const canonical = catalogueSlug(catalogue.name, catalogueId);
    if (param === canonical && tabParam === activeTab) {
      return;
    }
    void navigate(`/manage/catalogue/${canonical}/settings/${activeTab}`, {
      replace: true,
    });
  }, [param, tabParam, activeTab, catalogue, catalogueId, navigate]);

  if (!catalogueId) {
    return <Alert color="red">Invalid catalogue id</Alert>;
  }

  if (loading) {
    return <Loader />;
  }

  if (loadError) {
    return <Alert color="red">{loadError}</Alert>;
  }

  // The load resolves to exactly one of a document and a load error before
  // `loading` clears, so past the two gates above the document is the one the
  // tabs and the save folds work from; this last check is the compiler's
  // witness to that invariant. The loaded skin and bag are resolved through
  // the registry rather than stored raw, which is also what a save compares
  // against.
  if (!catalogue) {
    return <Loader />;
  }
  const loadedSkin = resolveSkin(catalogue.skin);
  const { options: loadedOptions, dropped } = resolveSkinOptions(
    loadedSkin,
    catalogue.skinOptions,
  );

  /**
   * The one write path. The payload is already the decision's answer, so here
   * the page only moves it: no navigation on success, a notification naming
   * what was saved, and the document re-stamped so the address and the tabs
   * work from what the server now holds.
   */
  const save = async (payload: CatalogueUpdatePayload, message: string) => {
    setSaving(true);
    try {
      const saved = await catalogueService.updateCatalogue(
        catalogueId,
        payload,
      );
      setCatalogue(saved);
      // Only the save that actually carried the visibility is a publish or
      // unpublish; the other tabs' saves leave it alone.
      if ("isPublic" in payload) {
        trackEvent("catalogue_visibility_changed", {
          is_public: saved.isPublic === true,
        });
      }
      notifications.show({
        color: "green",
        title: "Saved",
        message,
      });
    } catch (err) {
      console.error("Error updating catalogue:", err);
      notifications.show({
        color: "red",
        title: "Save failed",
        message: "Failed to save settings. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveGeneral = async (edited: GeneralEditedValues) => {
    // The same fold the tab's disabled Save reads, over the document the page
    // last loaded or saved. An error is a client-side refusal — the passwords
    // do not match, the password is too short — and the notification is where
    // the member is told why; the input stays on screen either way.
    const decision = resolveGeneralSave(
      {
        name: catalogue.name,
        description: catalogue.description ?? null,
        isPublic: catalogue.isPublic === true,
        isPasswordProtected: catalogue.isPasswordProtected === true,
        kind: catalogue.kind,
        artworkFields: catalogue.artworkFields ?? null,
      },
      edited,
    );
    if (decision.kind === "error") {
      notifications.show({
        color: "red",
        title: "Save failed",
        message: decision.message,
      });
      return;
    }
    // The tab keeps the Save off when the payload is empty; the same fact
    // guarded here, so a Save that is ever offered has something to write.
    if (Object.keys(decision.payload).length === 0) {
      return;
    }
    await save(decision.payload, "General settings saved.");
  };

  const savePublic = async (edited: PublicEditedValues) => {
    const payload = resolvePublicSave(
      { skin: loadedSkin.id, skinOptions: loadedOptions },
      edited,
    );
    if (Object.keys(payload).length === 0) {
      return;
    }
    await save(payload, "Public view settings saved.");
  };

  return (
    <Container size="xl">
      <Group justify="space-between" align="center" mb="xl" gap="xl">
        <Text size="h2">Catalogue Settings</Text>
        {/* One obvious step, for every tab: back to the catalogue. */}
        <Button
          component={Link}
          to={`/manage/catalogue/${param}`}
          variant="outline"
        >
          Back to catalogue
        </Button>
      </Group>

      {/*
        Controlled: the tab in the address is the tab shown, and choosing
        another is a navigation, not local state — which is what makes each
        tab a real address and a refresh keep the member on it.
        `keepMounted={false}` is the deliberate half of that: the inactive
        panels unmount, so the Access card fetches nothing until its tab is
        reached and a tab left mid-edit comes back clean.
      */}
      <Tabs
        value={activeTab}
        onChange={(value) => {
          if (value === null) {
            return;
          }
          void navigate(`/manage/catalogue/${param}/settings/${value}`);
        }}
        keepMounted={false}
      >
        <Tabs.List>
          <Scroller>
            {SETTINGS_TABS.map((tab) => (
              <Tabs.Tab key={tab} value={tab}>
                {TAB_LABELS[tab]}
              </Tabs.Tab>
            ))}
          </Scroller>
        </Tabs.List>

        <Tabs.Panel value="general">
          <GeneralTab
            catalogue={catalogue}
            saving={saving}
            onSave={saveGeneral}
          />
        </Tabs.Panel>

        <Tabs.Panel value="public">
          <PublicTab
            skin={loadedSkin.id}
            skinOptions={loadedOptions}
            staleOptionCount={dropped.length}
            saving={saving}
            onSave={savePublic}
          />
        </Tabs.Panel>

        {/* The card draws its own card, so the panel renders it directly;
            keyed by id so another catalogue starts from a loading card
            rather than the previous catalogue's members. */}
        <Tabs.Panel value="access">
          <AccessCard key={catalogueId} catalogueId={catalogueId} />
        </Tabs.Panel>

        <Tabs.Panel value="data">
          <DataTab catalogueParam={param ?? ""} catalogue={catalogue} />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
};

export default CatalogueSettingsPage;
