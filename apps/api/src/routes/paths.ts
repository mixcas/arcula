// The Collection namespace's second spelling, during the rename's contract
// window (ADR-0010, #246).
//
// Every route that names a Catalogue is registered twice with the same
// handlers: `/catalogues/…` is the mounted route family, and `/collections/…`
// is the legacy spelling that keeps answering identically until the contract
// step removes it. Nothing is rewritten at request time — Hono holds two
// explicit routes pointing at one handler — so the legacy alias costs no
// dispatch and cannot drift from the route it mirrors.
//
// Only catalogue-scoped paths belong here. The flat paths — `/invitations/…`,
// `/me/…`, `/media`, `/artist-names`, `/pdf` — name no catalogue and are
// registered once.

import type { Handler, Hono } from "hono";

const CATALOGUE_PREFIX = "/catalogues";
const COLLECTION_PREFIX = "/collections";

type Handlers = [Handler, ...Handler[]];
type Method = "get" | "post" | "patch" | "delete";

/**
 * The legacy Collection spelling of a Catalogue path. Refuses anything else,
 * so a wrong argument fails at registration rather than quietly mounting a
 * second copy of an unrelated route.
 */
export function legacyCollectionPath(path: string): string {
  if (path !== CATALOGUE_PREFIX && !path.startsWith(`${CATALOGUE_PREFIX}/`)) {
    throw new Error(`Not a Catalogue path: ${path}`);
  }
  return `${COLLECTION_PREFIX}${path.slice(CATALOGUE_PREFIX.length)}`;
}

function register(
  app: Hono,
  method: Method,
  path: string,
  handlers: Handlers,
): void {
  const alias = legacyCollectionPath(path);
  switch (method) {
    case "get":
      app.get(path, ...handlers);
      app.get(alias, ...handlers);
      return;
    case "post":
      app.post(path, ...handlers);
      app.post(alias, ...handlers);
      return;
    case "patch":
      app.patch(path, ...handlers);
      app.patch(alias, ...handlers);
      return;
    case "delete":
      app.delete(path, ...handlers);
      app.delete(alias, ...handlers);
      return;
  }
}

/** The four verbs a route module registers under both names. */
export interface AliasedRoutes {
  get(path: string, ...handlers: Handlers): void;
  post(path: string, ...handlers: Handlers): void;
  patch(path: string, ...handlers: Handlers): void;
  delete(path: string, ...handlers: Handlers): void;
}

/**
 * Register on `app` through the returned facade: every call mounts the route
 * under `/catalogues/…` and its legacy `/collections/…` twin. The call sites
 * keep their ordinary shape, and the method stays explicit.
 */
export function withLegacyCollectionAlias(app: Hono): AliasedRoutes {
  return {
    get: (path, ...handlers) => register(app, "get", path, handlers),
    post: (path, ...handlers) => register(app, "post", path, handlers),
    patch: (path, ...handlers) => register(app, "patch", path, handlers),
    delete: (path, ...handlers) => register(app, "delete", path, handlers),
  };
}
