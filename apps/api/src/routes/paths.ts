// The Collection namespace's second spelling, during the rename's expand
// window (ADR-0010, #244).
//
// Every route that names a Collection is registered twice with the same
// handlers: `/collections/…` for the old caller and `/catalogues/…` for the
// new name. Nothing is rewritten at request time — Hono holds two explicit
// routes pointing at one handler — so the alias costs no dispatch and cannot
// drift from the route it mirrors. The alias is removed in the contract step,
// when `/collections` goes and `/catalogues` becomes the only spelling.
//
// Only collection-scoped paths belong here. The flat paths — `/invitations/…`,
// `/me/…`, `/media`, `/artist-names`, `/pdf` — name no collection and are
// registered once.

import type { Handler, Hono } from "hono";

const COLLECTION_PREFIX = "/collections";
const CATALOGUE_PREFIX = "/catalogues";

type Handlers = [Handler, ...Handler[]];
type Method = "get" | "post" | "patch" | "delete";

/**
 * The Catalogue spelling of a Collection path. Refuses anything else, so a
 * wrong argument fails at registration rather than quietly mounting a second
 * copy of an unrelated route.
 */
export function cataloguePath(path: string): string {
  if (path !== COLLECTION_PREFIX && !path.startsWith(`${COLLECTION_PREFIX}/`)) {
    throw new Error(`Not a Collection path: ${path}`);
  }
  return `${CATALOGUE_PREFIX}${path.slice(COLLECTION_PREFIX.length)}`;
}

function register(
  app: Hono,
  method: Method,
  path: string,
  handlers: Handlers,
): void {
  const alias = cataloguePath(path);
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
 * under `/collections/…` and its `/catalogues/…` alias. The call sites keep
 * their ordinary shape, and the method stays explicit.
 */
export function withCatalogueAlias(app: Hono): AliasedRoutes {
  return {
    get: (path, ...handlers) => register(app, "get", path, handlers),
    post: (path, ...handlers) => register(app, "post", path, handlers),
    patch: (path, ...handlers) => register(app, "patch", path, handlers),
    delete: (path, ...handlers) => register(app, "delete", path, handlers),
  };
}
