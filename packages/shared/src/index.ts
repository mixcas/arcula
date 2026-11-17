// The client contract, re-exported whole.
//
// Importers use the package name (`@arcula/shared`), never a subpath: one
// entry point keeps the shape of the contract visible in one place, and the
// star re-exports are the surface the web and the API both compile against.
export * from "./types";
export * from "./caps";
export * from "./email";
export * from "./ids";
export * from "./invitationTime";
export * from "./limits";
export * from "./pdfFallback";
export * from "./artworkPhotos";
export * from "./artworkSearch";
export * from "./slug";
export * from "./schemas/access";
export * from "./schemas/artistNames";
export * from "./schemas/artwork";
export * from "./schemas/artworkImport";
export * from "./schemas/catalogue";
export * from "./schemas/document";
export * from "./schemas/invitation";
export * from "./schemas/media";
export * from "./schemas/user";
export * from "./stagedUpload";
