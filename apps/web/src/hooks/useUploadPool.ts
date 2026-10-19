/**
 * The upload pool behind both artwork lists.
 *
 * A file that lands in a form is staged the moment it is added, and a batch
 * stages at most three at a time and appends in drop order only once every
 * file has settled: a slow second file must not sit behind a fast one in the
 * sequence the user dropped. The progress bar counts settlements, so it moves
 * on failures too.
 *
 * What is *not* here is the part the two lists genuinely disagree on: what
 * admits a file (`isAcceptedImageType` vs the document allowlist), what it
 * costs against the cap, how a staged entry is shaped, and what the save sends
 * — a reorderable sequence of ids for photos, an id set for documents. Those
 * stay in `useArtworkPhotos` / `useArtworkDocuments`, where a reader can see
 * them side by side; this hook is only the queue and the bar.
 */

import { useCallback, useState } from "react";

/** A file refused, with a reason the user can act on. Never swallowed. */
export interface Rejection {
  file: File;
  reason: string;
}

/** The answer for one file through stage (+ process for an image). */
export type StageOutcome<TEntry> =
  { entry: TEntry; rejection: null } | { entry: null; rejection: string };

/** How many files a batch stages at a time. */
const CONCURRENCY = 3;

export const useUploadPool = () => {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const run = useCallback(
    async <TEntry>(
      files: File[],
      stage: (file: File) => Promise<StageOutcome<TEntry>>,
    ): Promise<{ added: TEntry[]; rejected: Rejection[] }> => {
      setProcessing(true);
      setProgress({ done: 0, total: files.length });

      // `results` keeps drop order — the caller appends in order — while `done`
      // counts settlements, so the bar moves on failures too. Holes until the
      // pool fills them; only read after `Promise.all` below. The explicit type
      // argument keeps the constructor's `any[]` overload from winning, which
      // is what made the slots lint as `any`.
      const results = new Array<StageOutcome<TEntry>>(files.length);
      let cursor = 0;
      let done = 0;
      const worker = async (file: File) => {
        const result = await stage(file);
        done += 1;
        setProgress({ done, total: files.length });
        return result;
      };
      const runners = Array.from(
        { length: Math.min(CONCURRENCY, files.length) },
        () =>
          (async () => {
            for (;;) {
              const index = cursor;
              cursor += 1;
              if (index >= files.length) {
                return;
              }
              results[index] = await worker(files[index]);
            }
          })(),
      );
      await Promise.all(runners);
      setProcessing(false);
      setProgress(null);

      const added: TEntry[] = [];
      const rejected: Rejection[] = [];
      results.forEach((result, index) => {
        if (result.rejection !== null) {
          rejected.push({ file: files[index], reason: result.rejection });
        } else {
          added.push(result.entry);
        }
      });
      return { added, rejected };
    },
    [],
  );

  return { processing, progress, run };
};

/**
 * A per-list key source: `photo-1`, `document-1`, monotonic and stable.
 *
 * A reorder moves the entry and keeps its key, so reconciliation keeps the
 * right node: the key is identity, the array position is the sequence.
 */
export const keySequence = (prefix: string): (() => string) => {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
};

export type UseUploadPool = ReturnType<typeof useUploadPool>;
