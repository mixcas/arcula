/**
 * The landing page's copy, in one module.
 *
 * Every sentence on `/` lives here rather than in the sections that render it,
 * so the page can be re-worded without untangling layout. The sections import
 * these constants; a later ticket appends its own named block below the ones
 * already here, in page order, and changes no component to do it.
 *
 * The copy is the product's voice, not a fixture: nothing in the suite asserts
 * it.
 */

/**
 * The ids the page's own links target.
 *
 * Both sides of a same-page link read the same constant — the link in
 * `LANDING_HERO` and the section that carries the id — so a renamed anchor
 * cannot leave a dead jump behind. Later sections add their ids here as they
 * land.
 */
export const LANDING_ANCHORS = {
  whatItDoes: "what-it-does",
} as const;

/** A router destination, with the label that announces it. */
export interface LandingAction {
  label: string;
  /** An app route, e.g. `/signup` or `/manage`. */
  href: string;
}

export interface LandingHeroContent {
  headline: string;
  lede: string;
  /** What the hero offers before anyone signs in and once they have. */
  actions: {
    signedOut: LandingAction;
    signedIn: LandingAction;
    /**
     * A jump on this page: the anchor's key rather than its id, resolved
     * against `LANDING_ANCHORS` by the hero. Both ends then read the same
     * constant, and a renamed anchor is a type error here.
     */
    secondary: { label: string; anchor: keyof typeof LANDING_ANCHORS };
  };
}

export const LANDING_HERO: LandingHeroContent = {
  headline: "Your art deserves a better record.",
  lede: "Arcula is catalogue management for people who own, make and sell art. Keep the work, the details that make it singular, and the people you share it with in one place — then decide what the world sees.",
  actions: {
    signedOut: {
      label: "Create your first catalogue",
      href: "/signup",
    },
    signedIn: {
      label: "Open your catalogues",
      href: "/manage",
    },
    secondary: {
      label: "See what Arcula does",
      anchor: "whatItDoes",
    },
  },
};

/** One labelled fact in the example record. */
export interface LandingRecordField {
  label: string;
  value: string;
}

export interface LandingExampleRecord {
  /** The visible label that keeps the panel from reading as a screenshot. */
  label: string;
  title: string;
  artist: string;
  fields: LandingRecordField[];
  caption: string;
}

/**
 * The hero's example record.
 *
 * PLACEHOLDER: this is a fictional work, shown so the page can make the
 * record's distinction concrete (a text date, and two separate prices).
 * Replace this one object when the artist's permission for a real work
 * arrives, and keep the `label` above it — the panel is an example until the
 * work and its details are cleared.
 */
export const LANDING_EXAMPLE_RECORD: LandingExampleRecord = {
  label: "Example record",
  title: "Study in Ochre",
  artist: "Ada Moreau",
  fields: [
    { label: "Date of creation", value: "circa 1889" },
    { label: "Medium", value: "Oil on canvas" },
    { label: "Dimensions", value: "64 × 48 cm" },
    {
      label: "Provenance",
      value:
        "Studio of the artist; private collection, Lyon, 1954; acquired 2019.",
    },
    { label: "Acquisition price", value: "€4,200" },
    { label: "Current price", value: "Not estimated" },
  ],
  caption:
    "An example record. Dates stay as written; what you paid and what it may be worth stay separate.",
};

/**
 * The page's head metadata.
 *
 * The description is the hero's promise in one sentence: what a search result
 * and a shared link show before anyone has seen the page. No Open Graph image
 * is declared, because none exists.
 */
export const LANDING_METADATA = {
  title: "Arcula — Art catalogue management",
  description:
    "Arcula is catalogue management for people who own, make and sell art — keep the work, the details that make it singular, and the people you share it with in one place.",
  url: "https://arcula.art/",
  type: "website",
} as const;
