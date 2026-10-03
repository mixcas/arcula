# @arcula/db

The Drizzle schema for the Arcula backend (plan §4: nine tables).

Phase 1 builds this: the four Better Auth core tables (extended with the typed
`user` columns of §0.3) plus collections, artworks, artwork_photos,
artwork_photo_variants and artwork_documents. Until then this package is an
empty shell — the workspace member exists so the schema has a stable home, and
nothing drizzle-specific is installed yet.

The schema must be **runtime-free**: no driver, no driver-specific types, no
DOM. It is imported by the API (over the live driver) and by the migration
tooling (over whatever the migration holds a connection to), so anything
runtime-specific belongs in the importer, not here.
