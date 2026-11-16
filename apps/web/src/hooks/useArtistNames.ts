/**
 * The Artist Name suggestions, loaded once per form mount.
 *
 * The suggestions are the caller's whole artist vocabulary, not one
 * catalogue's, so the hook takes no catalogue id.
 *
 * The dropdown is a convenience, so the whole hook is best effort: a failed
 * request leaves an empty list, which makes the Artist Name field a plain text
 * input. There is deliberately no notification — the field still works, and
 * the failure is not the collector's to fix. There is also no cache and no
 * refetch: reopening the form is what refreshes the list, so a name saved a
 * minute ago is offered next time.
 */

import { useEffect, useState } from "react";
import { artistNameService } from "@/services/artistNameService";

export interface UseArtistNames {
  /** The suggestions, empty until the request lands (or if it fails). */
  names: string[];
  /** True while the one request is in flight, for the field's indicator. */
  loading: boolean;
}

export function useArtistNames(): UseArtistNames {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A form the collector closes mid-request must not set state afterwards.
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await artistNameService.getArtistNames();
        if (!cancelled) setNames(loaded);
      } catch (err) {
        // Silent by contract: the field stays usable with no suggestions.
        console.error("Error loading artist names:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { names, loading };
}
