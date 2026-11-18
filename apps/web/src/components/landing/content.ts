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

/** One of the three things a catalogue holds at once, kept distinct. */
export interface LandingRecordGroup {
  /** The group's sub-heading, e.g. `The work`. */
  title: string;
  body: string;
}

export interface LandingRecordContent {
  /** The small numbered label above the heading. */
  label: string;
  heading: string;
  lede: string;
  groups: LandingRecordGroup[];
}

/**
 * The record: why a catalogue is not a spreadsheet, in three groups.
 *
 * The groups are the section's argument — the work, the story and the market
 * are three different kinds of fact, and the product keeps them apart. They
 * are data rather than markup so their order and wording are changed here,
 * with no component to untangle.
 */
export const LANDING_RECORD: LandingRecordContent = {
  label: "01 — The record",
  heading: "Art is not tidy data.",
  lede: "A spreadsheet gives every work one row and every fact one cell. A catalogue has to hold three things at once — and keep them distinct.",
  groups: [
    {
      title: "The work",
      body: "Photographs, medium, dimensions, edition, condition. What the work is, what it is made of, and what state it is in.",
    },
    {
      title: "The story",
      body: "Provenance, acquisition date, place of origin, notes, documents. The chain of hands and paper behind the work.",
    },
    {
      title: "The market",
      body: "What you paid, what you believe it is worth now, and whether it is available. Three different facts, never one column called “value”.",
    },
  ],
};

/** One of the three catalogue kinds, and the audience it speaks to. */
export interface LandingCatalogueKind {
  name: string;
  /** The one line that tells a visitor whether the kind is for them. */
  audience: string;
}

export interface LandingCataloguesContent {
  /** The small numbered label above the heading. */
  label: string;
  heading: string;
  kinds: LandingCatalogueKind[];
  /** The line that closes the section: the kinds are not a role choice. */
  closing: string;
}

/**
 * The three kinds a catalogue can be.
 *
 * They are one product, not three tiers: the section's job is to let an
 * artist, a collector and a gallery each recognise themselves, and then to
 * say that one account can hold all three. The order is the order the kinds
 * were specified in, and the names are the product's own.
 */
export const LANDING_CATALOGUES: LandingCataloguesContent = {
  label: "02 — The catalogues",
  heading: "One home, three ways to hold a body of work.",
  kinds: [
    { name: "Portfolio", audience: "For an artist's body of work." },
    { name: "Collection", audience: "For what a collector owns." },
    { name: "Inventory", audience: "For what a gallery represents for sale." },
  ],
  closing: "One account can hold all three.",
};

/** One move between an empty account and a catalogue with a decision on it. */
export interface LandingGettingStartedStep {
  name: string;
  detail: string;
}

export interface LandingGettingStartedContent {
  label: string;
  heading: string;
  steps: LandingGettingStartedStep[];
}

/**
 * The three moves from a work to a record.
 *
 * The section stops at the catalogue's own decisions: it deliberately does not
 * explain the mechanics of filling in a name or a biography. Each step names
 * what the person decides, not which control they click.
 */
export const LANDING_GETTING_STARTED: LandingGettingStartedContent = {
  label: "03 — Getting started",
  heading: "From a work to a record, in three moves.",
  steps: [
    {
      name: "Choose the kind",
      detail:
        "Portfolio, Collection or Inventory. It sets the language and the fields the catalogue starts from.",
    },
    {
      name: "Record the work",
      detail:
        "Add the details you keep, attach the photos and documents, and leave out what you don't track.",
    },
    {
      name: "Decide who sees it",
      detail:
        "Publish a page, generate a catalogue PDF, invite collaborators, or keep it private.",
    },
  ],
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

/** One capability: the way it is named, and the sentence that explains it. */
export interface LandingFeature {
  name: string;
  body: string;
}

export interface LandingFeaturesContent {
  /** `04 — What it does`: the number keeps the page's sections countable. */
  label: string;
  heading: string;
  /** The anti-CRM sentence: what the product does not try to be. */
  lede: string;
  items: LandingFeature[];
}

/**
 * What the product actually does, in six capabilities.
 *
 * The lede says what Arcula is not, because the market's alternatives are a
 * CRM, a website builder and an accounting system; naming them costs one
 * sentence and stops the visitor guessing. The items are concrete so the page
 * never has to claim a feature the product does not have.
 */
export const LANDING_FEATURES: LandingFeaturesContent = {
  label: "04 — What it does",
  heading: "Built around the record, not around a sales pipeline.",
  lede: "Arcula does the work of a catalogue. It is not a CRM, a website builder or an accounting system.",
  items: [
    {
      name: "A public page",
      body: "A full-bleed page, one work at a time, with its own address. No site to build, no theme to maintain.",
    },
    {
      name: "A catalogue PDF",
      body: "A document generated in the browser from the works you’ve published. Nothing is stored twice.",
    },
    {
      name: "Access on your terms",
      body: "Public, Private, or Protected by a password. Visitors see published works; drafts, deleted works and documents never appear.",
    },
    {
      name: "Collaboration",
      body: "Invite collaborators by email, edit alongside them, and transfer ownership when the catalogue changes hands. The work stays where it is.",
    },
    {
      name: "Catalogue search",
      body: "Search the fields a catalogue records, filter by values, and keep the query in the address so it can be linked.",
    },
    {
      name: "CSV import",
      body: "Map a CSV’s columns to the fields your catalogue records, review the rows, then import a body of work.",
    },
  ],
};

export interface LandingAgentBandContent {
  /**
   * The band's heading and its only content. A capability statement, not an
   * integration guide: no endpoint, no tool list, no protocol.
   */
  statement: string;
}

/**
 * The agent band: one sentence, unnumbered.
 *
 * It is deliberately not a section in the same sense as the others — the page
 * has to stay readable, and the protocol detail lives in the client setup
 * guide. The band exists so a visitor learns the option exists, and stops
 * there.
 */
export const LANDING_AGENT_BAND: LandingAgentBandContent = {
  statement:
    "Integrate with your favourite AI agents and let them manage your catalogues.",
};
