/**
 * A Catalogue's Selections: the list a member reaches from the Catalogue's
 * header, and the one place a Selection is created.
 *
 * The page loads the Catalogue (for its name and its canonical address) and the
 * list together, then rewrites the address to `{catalogue-slug}-{id}` once both
 * are known. The empty state is the first visit's explanation of what a
 * Selection is; the modal is the only form in this slice.
 *
 * Every mutation re-reads the list and only then notifies — the manage area's
 * rule, so the list is always the server's answer rather than a local splice.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  catalogueSlug,
  parseId,
  selectionSlug,
  type Catalogue,
  type SelectionPageRow,
} from "@arcula/shared";
import { catalogueService } from "@/services/catalogueService";
import { selectionService } from "@/services/selectionService";
import { ApiRequestError } from "@/services/api";
import { relativeTime } from "@/utils/relativeTime";

/** What a member calls a Selection's audience, as the badge shows it. */
const visibilityWord = (row: SelectionPageRow): string => {
  if (!row.isPublic) return "Private";
  return row.isPasswordProtected === true ? "Protected" : "Public";
};

const worksWord = (count: number): string =>
  count === 1 ? "1 work" : `${count} works`;

const SelectionsPage: React.FC = () => {
  const { catalogueId: param } = useParams<{ catalogueId: string }>();
  // Routes carry "{slug}-{id}" but the API needs the id alone; parsing down to
  // the id is what lets the canonical rewrite change the address without
  // re-triggering the fetch.
  const catalogueId = parseId(param ?? "");
  const navigate = useNavigate();

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selections, setSelections] = useState<SelectionPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!catalogueId) return;
    const rows = await selectionService.list(catalogueId);
    setSelections(rows);
    setListError(null);
  }, [catalogueId]);

  useEffect(() => {
    if (!catalogueId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [loadedCatalogue, rows] = await Promise.all([
          catalogueService.getCatalogue(catalogueId),
          selectionService.list(catalogueId),
        ]);
        if (cancelled) return;
        if (!loadedCatalogue) {
          setPageError("Catalogue not found");
          return;
        }
        setCatalogue(loadedCatalogue);
        setSelections(rows);
        setPageError(null);
        setListError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading the selections:", err);
        setListError("Could not load the selections. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [catalogueId]);

  // Once the name is known, put the canonical "{slug}-{id}" in the address bar.
  // `replace` swaps the current history entry so Back returns to wherever the
  // member came from. A Catalogue that failed to load never reaches here, so a
  // private name is never written into history.
  useEffect(() => {
    if (!param || !catalogue) return;
    const canonical = catalogueSlug(catalogue.name, catalogue.id);
    if (canonical === param) return;
    void navigate(`/manage/catalogue/${canonical}/selections`, {
      replace: true,
    });
  }, [param, catalogue, navigate]);

  const openCreate = () => {
    setName("");
    setDescription("");
    setFormError(null);
    setCreateOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setFormError("Selection name is required");
      return;
    }
    if (creating) return;
    setCreating(true);
    setFormError(null);
    try {
      await selectionService.create(catalogueId, {
        name: trimmedName,
        description: description.trim() === "" ? undefined : description.trim(),
      });
      await loadList();
      setCreateOpen(false);
      notifications.show({
        color: "green",
        title: "Selection created",
        message: "Add works from the catalogue when you are ready.",
      });
    } catch (err) {
      console.error("Error creating the selection:", err);
      setFormError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not create the selection. Nothing was created — try again.",
      );
    } finally {
      setCreating(false);
    }
  };

  if (!catalogueId) {
    return <Alert color="red">Catalogue not found</Alert>;
  }

  if (loading) {
    return <Loader />;
  }

  if (pageError) {
    return <Alert color="red">{pageError}</Alert>;
  }

  return (
    <>
      <Group justify="space-between" align="center" mb="xl" gap="xl">
        <Group>
          <Text size="h2">Selections</Text>
          {catalogue ? (
            <Text c="dimmed" size="sm">
              from {catalogue.name}
            </Text>
          ) : null}
        </Group>
        <Group>
          <Button
            component={Link}
            to={`/manage/catalogue/${param ?? ""}`}
            variant="outline"
          >
            Back to catalogue
          </Button>
          {selections.length > 0 ? (
            <Button onClick={openCreate}>Create selection</Button>
          ) : null}
        </Group>
      </Group>

      {listError ? (
        <Alert color="red" mb="xl">
          {listError}
        </Alert>
      ) : null}

      {selections.length === 0 ? (
        <Stack align="center" gap="sm" py="xl">
          <Text size="h3">No selections yet</Text>
          <Text c="dimmed" maw={520} ta="center">
            A selection is a curated subset of this catalogue&rsquo;s works with
            its own address. Start one, then add works in the order you want
            them shown.
          </Text>
          <Button onClick={openCreate} mt="sm">
            Create selection
          </Button>
        </Stack>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Visibility</Table.Th>
              <Table.Th>Works</Table.Th>
              <Table.Th>Last change</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {selections.map((selection) => (
              <Table.Tr key={selection.id}>
                <Table.Td>
                  <Text
                    component={Link}
                    to={`/manage/catalogue/${param ?? ""}/selection/${selectionSlug(
                      selection.name,
                      selection.id,
                    )}`}
                  >
                    {selection.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    variant="light"
                    color={selection.isPublic ? "green" : "gray"}
                  >
                    {visibilityWord(selection)}
                  </Badge>
                </Table.Td>
                <Table.Td>{worksWord(selection.workCount)}</Table.Td>
                <Table.Td>{relativeTime(selection.updatedAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="New selection"
        centered
      >
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Stack>
            <TextInput
              label="Name"
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setFormError(null);
              }}
              required
              data-autofocus
              error={formError}
            />
            <Textarea
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Group justify="flex-end">
              <Button
                type="button"
                variant="default"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" loading={creating}>
                Create selection
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
};

export default SelectionsPage;
