// The two orderings curation depends on, as pure folds.
//
// Both answer the same product promise — "works added in the order I checked
// them" (user story 8) — from the two different lists the UI already holds. The
// drag list states a whole order and asks which move the drop was; the artworks
// list is told a checked *set* and has to remember the order the ticks happened
// in, because the Table reports its rows in catalogue sort order.

import { describe, expect, it } from "vitest";
import {
  checkedOrder,
  moveWorkIds,
} from "@/components/manage/catalogue/curationOrder";

describe("moveWorkIds — a drag's new order", () => {
  it("moves a work down to where it was dropped", () => {
    expect(moveWorkIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("moves a work up to where it was dropped", () => {
    expect(moveWorkIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("leaves the list alone when the drop lands on itself", () => {
    expect(moveWorkIds(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("leaves the list alone when an id is not in it", () => {
    expect(moveWorkIds(["a", "b"], "a", "z")).toEqual(["a", "b"]);
    expect(moveWorkIds(["a", "b"], "z", "a")).toEqual(["a", "b"]);
  });
});

describe("checkedOrder — the order the ticks happened in", () => {
  it("keeps a single tick", () => {
    expect(checkedOrder([], ["b"])).toEqual(["b"]);
  });

  it("appends a new tick even when the view reports it in sort order", () => {
    // The Table hands back its checked rows in catalogue order: tick "b", then
    // tick "a", and the second report is ["a", "b"]. "a" is the new one, so it
    // goes last — the order they were checked, not the order they are shown.
    expect(checkedOrder(["b"], ["a", "b"])).toEqual(["b", "a"]);
  });

  it("drops a work that was unticked", () => {
    expect(checkedOrder(["b", "a"], ["a"])).toEqual(["a"]);
  });

  it("puts a re-ticked work back at the end", () => {
    // The sequence a person actually performs: tick b, tick a, untick b
    // (`["a"]`), then tick b again — the Table reports ["a", "b"] and b is the
    // new one.
    expect(checkedOrder(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("leaves the grid's own order untouched", () => {
    // The Grid adds each card to the end as it is ticked, so its report is
    // already the checked order.
    expect(checkedOrder(["a", "b"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("appends a page-wide select after what was already checked", () => {
    expect(checkedOrder(["x"], ["a", "b", "x"])).toEqual(["x", "a", "b"]);
  });
});
