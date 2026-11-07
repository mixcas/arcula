import React, { useState, useEffect, useCallback, useRef } from "react";
import debounce from "lodash/debounce";
import {
  ActionIcon,
  Button,
  CloseButton,
  Group,
  Menu,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconDotsVertical,
  IconFolderCancel,
  IconSettings,
  IconZoom,
} from "@tabler/icons-react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import {
  collectionSlug,
  artworkSearchSuffix,
  MAX_SEARCH_QUERY_LENGTH,
  parseId,
  searchQueryOverflow,
} from "@arcula/shared";
import ArtworksList from "./collection/ArtworksList";
import type { Artwork, Collection } from "@arcula/shared";

// Long enough to collect a word, short enough that the list feels live. The
// debounce is the only reason typing does not issue a read per keystroke.
const SEARCH_DEBOUNCE_MS = 300;

const CollectionPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but the API needs the id alone. Parsing down
  // to the id — rather than using the raw param — is what lets the canonical
  // rewrite below change the URL without re-triggering the fetch.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();
  const location = useLocation();
  // The committed query is the address's, not local state: a search is
  // reloadable, bookmarkable and shared, and Back/Forward moves between them.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const searchActive = query !== "";
  // Only the two pages that return here carry the search. Built from `q`
  // alone, so an unrelated parameter can never leak into a page that does not
  // read it; URLSearchParams does the encoding.
  const searchSuffix = artworkSearchSuffix(query);

  const [collection, setCollection] = useState<Collection | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  // A list read in flight, distinct from the first collection load: a search
  // keeps the table mounted, so the previous rows stay visible under it.
  const [fetching, setFetching] = useState(false);
  // Whether the list has answered at all. Before its first answer the page is
  // loading, not empty, so neither the empty-collection copy nor the
  // no-results panel may claim anything.
  const [listSettled, setListSettled] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  // The typed value belongs to the query it was typed under. While they agree,
  // the draft wins; when the address gains a query the collector did not type
  // (load, Back/Forward), the key no longer matches and the committed query is
  // shown instead. Deriving it this way is what keeps a draft intact through a
  // re-render without a setState-in-effect.
  const [draft, setDraft] = useState({ forQuery: query, text: query });
  const inputValue = draft.forQuery === query ? draft.text : query;

  // Every list read gets an id; a response whose id is no longer current is an
  // older search's answer and is discarded, however the network ordered them.
  const requestId = useRef(0);

  // Split out from the effect below so the artwork table can ask for a refresh
  // after a delete and Retry can ask for the current query again. It reports
  // its own failure rather than throwing: the table awaits this as `onDeleted`,
  // and a rejected promise there would be caught by the delete's error handler
  // and reported as a failed delete — which would be a lie, since the write
  // already went through.
  const loadArtworks = useCallback(
    async (search: string) => {
      if (!collectionId) return;
      const id = ++requestId.current;
      setFetching(true);
      setSearchError(null);
      try {
        // Every member sees every artwork, public or private, and never the
        // soft-deleted ones (the server filters those out). A member's query
        // narrows the same read; the public views pass none.
        const fetchedArtworks = await artworkService.getCollectionArtworks(
          collectionId,
          search,
        );
        if (id !== requestId.current) return;
        setArtworks(fetchedArtworks);
      } catch (err) {
        if (id !== requestId.current) return;
        console.error("Error fetching artworks:", err);
        // The previous rows are deliberately kept: a failed search is an
        // inline answer, not an empty page. The wording follows the read that
        // failed — only a query is a search.
        setSearchError(
          search.trim() === ""
            ? "Failed to fetch artworks"
            : "Failed to search artworks",
        );
      } finally {
        if (id === requestId.current) {
          setFetching(false);
          setListSettled(true);
        }
      }
    },
    [collectionId],
  );

  useEffect(() => {
    const fetchCollectionData = async () => {
      if (!collectionId) return;

      try {
        const fetchedCollection =
          await collectionService.getCollection(collectionId);
        if (!fetchedCollection) {
          setPageError("Collection not found");
          setLoading(false);
          return;
        }

        setCollection(fetchedCollection);
        setLoading(false);
      } catch (err) {
        // The collection itself is the page: without it there is no table, no
        // search and nothing to retry in place.
        console.error("Error fetching collection data:", err);
        setPageError("Failed to fetch collection data");
        setLoading(false);
      }
    };

    void fetchCollectionData();
  }, [collectionId]);

  // The list follows the committed query. The query is a string (not the
  // searchParams object) in the dependency list, so a navigation that does not
  // change `q` — a sort click, an unrelated param — cannot loop the fetch.
  // The async wrapper keeps the effect's body free of synchronous setState,
  // which the hooks rule rejects.
  useEffect(() => {
    if (!collection) return;
    void (async () => {
      await loadArtworks(query);
    })();
  }, [collection, loadArtworks, query]);

  // Once the name is known, put the canonical "{slug}-{id}" in the address bar
  // so a link written with only the id still resolves to a readable URL.
  // `replace` swaps the current history entry, so Back returns to wherever the
  // user came from rather than to the un-slugged URL. The search is carried
  // over, or a shared `?q=…` would be dropped a moment after load. Re-running
  // is harmless: the guard settles once the param matches, and a collection
  // that failed to load never reaches here.
  useEffect(() => {
    if (!param || !collection) {
      return;
    }
    const canonical = collectionSlug(collection.name, collection.id);
    if (canonical === param) {
      return;
    }
    void navigate(
      { pathname: `/manage/collection/${canonical}`, search: location.search },
      { replace: true },
    );
  }, [param, collection, navigate, location.search]);

  /**
   * Write a query to the address and let the list follow it. Live search
   * replaces the current history entry — one entry per debounced pause would
   * flood the Back stack — while the address still carries `q`, so reload,
   * bookmark and share keep working. Clearing removes `q`. A query that breaks
   * a cap is explained inline and never sent.
   */
  const commit = (raw: string) => {
    const next = raw.trim();
    const overflow = searchQueryOverflow(next);
    if (overflow) {
      setInlineError(
        overflow === "too-many-terms"
          ? "Use 10 words or fewer."
          : `Use ${MAX_SEARCH_QUERY_LENGTH} characters or fewer.`,
      );
      setDraft({ forQuery: query, text: next });
      return;
    }
    setInlineError(null);
    setDraft({ forQuery: next, text: next });

    const params = new URLSearchParams(searchParams);
    if (next) params.set("q", next);
    else params.delete("q");
    // An unchanged address needs no refetch (clearing uncommitted draft text
    // is the common case).
    if (params.toString() === searchParams.toString()) return;
    setSearchParams(params, { replace: true });
  };

  // Typing commits after a pause instead of on Enter. The timer is created
  // once and reads the latest `commit` through a ref, so a render caused by the
  // collection or the list does not reset the debounce clock; the cleanup
  // cancels it on unmount.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  const debouncedCommitRef = useRef<ReturnType<typeof debounce> | null>(null);
  useEffect(() => {
    const debounced = debounce((value: string) => {
      commitRef.current(value);
    }, SEARCH_DEBOUNCE_MS);
    debouncedCommitRef.current = debounced;
    return () => debounced.cancel();
  }, []);

  // The X clears the input, the address and any search still waiting on the
  // debounce: cancelling first is what stops a pending commit from putting the
  // query back a moment after the collector dropped it.
  const clearSearch = () => {
    debouncedCommitRef.current?.cancel();
    commit("");
  };

  if (loading) {
    return <Text>Loading collection...</Text>;
  }

  if (pageError) {
    return <Text color="red">{pageError}</Text>;
  }

  if (!collection) {
    return <Text>Collection not found</Text>;
  }

  return (
    <>
      <Group justify="space-between" mb="xl" wrap="wrap">
        <Group wrap="wrap">
          <Text size="h2">{collection.name}</Text>
          {/*
            Opens in a new tab, so the owner can check the public page and the
            collection side by side without losing this one. A plain `href`
            rather than a router `Link`: the tab is a separate document, and
            `noopener` keeps it from reaching back through `window.opener` to
            this session. Neither this link nor the PDF carries the search: a
            visitor's page has no member tooling to filter.
          */}
          <Button
            variant="subtle"
            component="a"
            href={`/collection/${param ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View
          </Button>
          <Button
            variant="subtle"
            component="a"
            href={`/collection/${collectionSlug(
              collection.name,
              collection.id,
            )}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            PDF
          </Button>
        </Group>
        <Group wrap="wrap">
          <TextInput
            value={inputValue}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setInlineError(null);
              setDraft({ forQuery: query, text: next });
              debouncedCommitRef.current?.(next);
            }}
            placeholder="Search this collection"
            aria-label="Search this collection"
            leftSection={<IconZoom size={16} />}
            // The X answers either kind of text: an uncommitted draft or an
            // active search, so a search can always be dropped in one click.
            rightSection={
              inputValue.length > 0 || searchActive ? (
                <CloseButton aria-label="Clear search" onClick={clearSearch} />
              ) : null
            }
            // The right section ignores pointer events by default, which would
            // leave the X looking live and unclickable.
            rightSectionPointerEvents="all"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            error={inlineError}
            w={{ base: "100%", sm: 280 }}
          />
          <Button
            component={Link}
            to={`/manage/collection/${param}/artwork/add${searchSuffix}`}
          >
            Add Artwork
          </Button>
          {/* The two page-level destinations live behind one trigger so the
              bar has room for the title, the search and Add Artwork on a
              narrow screen. Neither item carries `q`: those pages do not
              search, and a filter they cannot show would be a lie. */}
          <Menu shadow="md" width={180} position="bottom-end">
            <Menu.Target>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Collection actions"
              >
                <IconDotsVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                component={Link}
                to={`/manage/collection/${param}/deleted`}
                leftSection={<IconFolderCancel size={16} />}
              >
                Deleted
              </Menu.Item>
              <Menu.Item
                component={Link}
                to={`/manage/collection/${param}/settings`}
                leftSection={<IconSettings size={16} />}
              >
                Settings
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <ArtworksList
        artworks={artworks}
        collectionParam={param ?? ""}
        onDeleted={() => loadArtworks(query)}
        searchQuery={query}
        fetching={fetching}
        listSettled={listSettled}
        searchError={searchError}
        onRetry={() => void loadArtworks(query)}
        onClearSearch={clearSearch}
      />
    </>
  );
};

export default CollectionPage;
