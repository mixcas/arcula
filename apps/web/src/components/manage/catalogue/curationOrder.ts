/**
 * The two orderings curation depends on.
 *
 * A Selection's order is the content (user story 8 and 11), and it is built
 * from two lists the UI already holds rather than a third source of truth:
 *
 * - **`moveWorkIds`** is a drag's answer. The sortable list knows which row was
 *   picked up and which it was dropped on; this says what the whole list is
 *   afterwards, so the drop handler has one line and one rule.
 * - **`checkedOrder`** is the checked works' order. The Grid appends each ticked
 *   card to the end, but the Table reports its checked rows in catalogue sort
 *   order — so a tick of the third row and then the first arrives as
 *   `[first, third]`. This folds that report against what was checked before:
 *   what is still checked keeps its place, and everything new goes on the end in
 *   the order the report named it. For a report that adds one id at a time —
 *   every Table click — that is exactly the order the ticks happened in.
 */

/** The id list after dragging `activeId` onto `overId`, or the list unchanged. */
export const moveWorkIds = (
  ids: readonly string[],
  activeId: string,
  overId: string,
): string[] => {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/**
 * The new checked order: the previous order, minus what was unticked, plus what
 * this report newly checked — in the order the report named it.
 */
export const checkedOrder = (
  previous: readonly string[],
  next: readonly string[],
): string[] => {
  const checked = new Set(next);
  const kept = previous.filter((id) => checked.has(id));
  const seen = new Set(previous);
  const added = next.filter((id) => !seen.has(id));
  return [...kept, ...added];
};
