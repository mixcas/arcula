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

import type { CatalogueKind } from "@arcula/shared";

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

/** One labelled fact in the record. */
export interface LandingRecordField {
  label: string;
  value: string;
}

/** The artwork plate that heads the record. */
export interface LandingRecordImage {
  /** A file under `public/`. */
  src: string;
  /**
   * Empty when the work's title and artist follow the image directly: naming
   * the work twice would only make a screen reader say it twice.
   */
  alt: string;
}

export interface LandingHeroRecord {
  image: LandingRecordImage;
  title: string;
  artist: string;
  fields: LandingRecordField[];
  caption: string;
}

/**
 * The hero's record: a real, credited work.
 *
 * It is here so the page's promise is concrete rather than a claim — the
 * record's distinctions are visible in it (a date written the way the work's
 * own history writes it, and what was paid kept apart from what it may be
 * worth). The work and the photograph are Daniel Robles's, supplied with
 * permission; the panel names him and the work, so nothing has to call the
 * record a sample.
 *
 * The image is not a background: the panel's plate contains the whole work
 * rather than cropping it, which is why a portrait plate is taller than it is
 * wide.
 */
export const LANDING_HERO_RECORD: LandingHeroRecord = {
  image: {
    src: "/images/daniel_robles_membrana.jpg",
    alt: "",
  },
  title: "Membrana",
  artist: "Daniel Robles",
  fields: [
    { label: "Date of creation", value: "circa 2018" },
    { label: "Medium", value: "Silicone, synthetic hair, fiberglass" },
    { label: "Dimensions", value: "64 × 48 cm" },
    { label: "Provenance", value: "The Yards Gallery" },
    { label: "Acquisition price", value: "$4,200" },
    { label: "Current price", value: "Not estimated" },
  ],
  caption:
    "Dates stay as written; what you paid and what it may be worth stay separate.",
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
  /**
   * Which kind: the review's own key, so the card wears the label, colour and
   * glyph every other screen gives that kind rather than a copy of them.
   */
  kind: CatalogueKind;
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
 * were specified in, and the names come from `catalogueSurface` so the page
 * cannot drift from the labels the app itself uses.
 */
export const LANDING_CATALOGUES: LandingCataloguesContent = {
  label: "02 — The catalogues",
  heading: "One home, three ways to hold a body of work.",
  kinds: [
    { kind: "portfolio", audience: "For an artist’s body of work." },
    { kind: "collection", audience: "For what a collector owns." },
    {
      kind: "inventory",
      audience: "For what a gallery represents for sale.",
    },
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
        "Add the details you keep, attach the photos and documents, and leave out what you don’t track.",
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

export interface LandingAgentMark {
  /** The client's name, and the mark's accessible name. */
  label: string;
  /** A file under `public/`, drawn as a paper silhouette on the ink band. */
  src: string;
}

export interface LandingAgentBandContent {
  /**
   * The band's heading and its only sentence. A capability statement, not an
   * integration guide: no endpoint, no tool list, no protocol.
   */
  statement: string;
  /**
   * The clients the sentence points at, seated beside it. Marks, not links:
   * the band names the option and still has nothing to click.
   */
  marks: LandingAgentMark[];
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
  marks: [
    { label: "Claude", src: "/images/Claude_AI_symbol.svg" },
    { label: "ChatGPT", src: "/images/ChatGPT-Logo.svg" },
    { label: "Hermes", src: "/images/hermes-agent.svg" },
  ],
};

/** One question the page answers, and the answer it settles on. */
export interface LandingQuestion {
  question: string;
  answer: string;
}

export interface LandingQuestionsContent {
  /** `05 — Questions`: the agent band is unnumbered, so the count has no gap. */
  label: string;
  heading: string;
  items: LandingQuestion[];
}

/**
 * The six questions a visitor actually asks before trying the product.
 *
 * The set is closed on purpose — audience, price, import, export, visibility
 * and deletion — and every answer is the product's current truth. The export
 * answer admits what is not built, because the page's argument is honesty and
 * the rest of it is only worth reading if this answer is.
 */
export const LANDING_QUESTIONS: LandingQuestionsContent = {
  label: "05 — Questions",
  heading: "A few honest answers.",
  items: [
    {
      question: "Who is Arcula for?",
      answer:
        "Independent collectors, artists and galleries: people who own, make or sell art and want a proper record of it. It is not built for institutional museum cataloguing.",
    },
    {
      question: "Is Arcula free?",
      answer: "Yes — Arcula is 100% free… for now.",
    },
    {
      question: "Can I import my spreadsheet?",
      answer:
        "Yes. Import a CSV, map its columns to the fields your catalogue records, review the rows, and bring in a body of work at once.",
    },
    {
      question: "Can I export my data?",
      answer:
        "You can generate a catalogue PDF today. A portable CSV/JSON export is on the roadmap; it is not built yet.",
    },
    {
      question: "Who can see my catalogue?",
      answer:
        "A catalogue can be Public, Private, or Protected by a password. Visitors see published works only; drafts, deleted works and documents stay private.",
    },
    {
      question: "What happens when I delete a work?",
      answer:
        "A slip costs nothing — a deleted work comes back whenever you want it, with its photographs and documents.",
    },
  ],
};

export interface LandingFinalActionContent {
  heading: string;
  body: string;
  /**
   * The closing action follows the session exactly as the hero's does. The
   * login door is signed-out only: an account holder has nothing to log in to,
   * and the section carries no sign-up link once there is a session.
   */
  actions: {
    signedOut: { primary: LandingAction; secondary: LandingAction };
    signedIn: { primary: LandingAction };
  };
}

/**
 * The page's last ask: one catalogue, not a tour of the product.
 *
 * It repeats the hero's primary action deliberately — the page is long, and a
 * reader who has scrolled this far should not have to scroll back up to start.
 */
export const LANDING_FINAL_ACTION: LandingFinalActionContent = {
  heading: "Start with one catalogue.",
  body: "Add a work, record what you know, and decide who sees it.",
  actions: {
    signedOut: {
      primary: { label: "Create your first catalogue", href: "/signup" },
      secondary: { label: "Log in", href: "/login" },
    },
    signedIn: {
      primary: { label: "Open your catalogues", href: "/manage" },
    },
  },
};

/** The contact address, held as two parts rather than one string. */
export interface LandingContact {
  /** The local part, e.g. `hello`. */
  user: string;
  /** The domain, without the `@`. */
  domain: string;
}

export interface LandingFooterContent {
  name: string;
  tagline: string;
  /** The only place the source is offered; there is no open-source section. */
  github: LandingAction;
  login: LandingAction;
  /**
   * Split on purpose: the footer renders the two parts as separate text
   * nodes and builds the `mailto:` only when someone clicks, so no complete
   * address and no complete link sits in the page. That defeats a scraper
   * reading the markup; a scraper that runs the page and reads the rendered
   * text still gets the address, and the only cure for that is a form.
   */
  contact: LandingContact;
  /** Dimmed beside the copyright, for whoever looks that far. */
  easterEgg: string;
  copyright: string;
}

/**
 * The footer: where the product is, how to reach it, and the way back in.
 *
 * It belongs to the landing page, not to the public layout, so the auth pages
 * keep their own chrome. GitHub is the page's only outbound link and opens in
 * a new tab; the address is assembled on click so a question needs no form.
 */
export const LANDING_FOOTER: LandingFooterContent = {
  name: "Arcula",
  tagline: "Catalogue management for people who own, make and sell the work.",
  github: { label: "GitHub", href: "https://github.com/mixcas/arcula" },
  login: { label: "Log in", href: "/login" },
  contact: { user: "hello", domain: "arcula.art" },
  easterEgg: "stan loona",
  copyright: "© 2026 Arcula.",
};
