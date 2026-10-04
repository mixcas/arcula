// The client contract, re-exported whole.
//
// Importers use the package name (`@arcula/shared`), never a subpath: one
// entry point keeps the shape of the contract visible in one place, and the
// star re-exports are the surface the web and the API both compile against.
export * from "./types";
export * from "./caps";
export * from "./limits";
export * from "./artworkPhotos";
export * from "./slug";
export * from "./schemas/artwork";
export * from "./schemas/artworkImport";
export * from "./schemas/collection";
export * from "./schemas/document";
