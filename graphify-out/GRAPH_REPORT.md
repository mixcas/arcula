# Graph Report - arcula  (2026-11-06)

## Corpus Check
- 322 files · ~244,686 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2134 nodes · 5551 edges · 127 communities (106 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 71 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Artwork CSV Import
- Media Object Keys
- Access Verdicts
- Invitations and Errors
- Password Hashing and Lambda
- Invitation API Tests
- Public Collection State
- Media Proxy Tests
- Artwork Documents
- Basicx Skin Options
- Public Page Tests
- Auth Transport
- PDF Photo Pipeline
- Wire Serialization
- Image Variants
- Shared Payload Schemas
- Drizzle Schema Tests
- Artwork Form Fields
- Collection Settings
- Photo Uploader
- Mail Templates
- Protected Collection Tests
- PDF Progress Bar
- Collection PDF Document
- Manage Layout
- Staged Uploads
- Database Migrations
- Artwork Schema Types
- Shared Wire Schemas
- Save API Tests
- Access Card and Time
- DB Package Config
- Mail Composition
- Web Package Config
- Access Service Client
- Web Dev Dependencies
- S3 Storage Layer
- Artworks Table
- Email Provider
- Collaborator Write Tests
- Ownership Transfer Tests
- Auth and Password Reset
- Manage Page Tests
- Invitation Inbox
- Access Card Tests
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 122
- Community 123

## God Nodes (most connected - your core abstractions)
1. `react` - 87 edges
2. `@mantine/core` - 76 edges
3. `react-router-dom` - 53 edges
4. `ApiError` - 47 edges
5. `req()` - 46 edges
6. `Artwork` - 37 edges
7. `Collection` - 35 edges
8. `ApiRequestError` - 28 edges
9. `collectionSlug()` - 28 edges
10. `db` - 26 edges

## Surprising Connections (you probably didn't know these)
- `arcula_grant_{collectionId} Cookie` --semantically_similar_to--> `Access grant`  [INFERRED] [semantically similar]
  apps/api/README.md → docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md
- `artwork_photo_variants (parentId, key) Upsert` --semantically_similar_to--> `Single-Transaction Save with Accepted Residual`  [INFERRED] [semantically similar]
  packages/db/README.md → apps/api/README.md
- `ArtworksTableProps` --references--> `Artwork`  [EXTRACTED]
  apps/web/src/components/manage/collection/ArtworksTable.tsx → packages/shared/src/types.ts
- `UseArtworkPhotosOptions` --references--> `ArtworkPhoto`  [EXTRACTED]
  apps/web/src/hooks/useArtworkPhotos.ts → packages/shared/src/types.ts
- `BasicxSectionProps` --references--> `Artwork`  [EXTRACTED]
  apps/web/src/skins/basicx/BasicxSection.tsx → packages/shared/src/types.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Collection password protection: unlock route, grant cookie, verdict, throttle** — docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_protected_collection, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_unlock_route, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_access_grant, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_unlock_throttle, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_lock_screen, apps_api_src_collectiongrants, apps_api_src_collectionpassword [EXTRACTED 1.00]
- **Collection PDF export pipeline: page plan, photo pipeline, geometry, fonts, viewer** — docs_specs_pdf_export_collection_pdf, docs_specs_pdf_export_page_plan, docs_specs_pdf_export_photo_pipeline, docs_specs_pdf_export_page_geometry, docs_specs_pdf_export_noto_sans_sc_fallback, docs_specs_pdf_export_collection_pdf_page_route [EXTRACTED 1.00]
- **Forward-only schema: migration releases ship alone before the code that reads them** — docs_adr_0001_two_branches_two_environments_rollback_by_revert_commit, docs_adr_0004_collections_are_shared_by_membership_forward_only_schema_two_migrations, docs_plans_collection_passwords_plan_release_1_schema_alone, docs_plans_collection_passwords_plan_migration_0005_collection_passwords [INFERRED 0.85]
- **Protected Collection Unlock Flow** — apps_api_readme_unlock_route, apps_api_readme_grant_cookie, apps_api_readme_collection_grants_module, apps_api_readme_unlock_throttle, packages_db_readme_access_grants_table, packages_db_readme_unlock_attempts_table, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_access_grant [EXTRACTED 1.00]
- **Collection Sharing Lifecycle** — apps_api_readme_access_ts_verdicts, apps_api_readme_authorize_ts, apps_api_readme_invitation_loop, apps_api_readme_access_read, apps_api_readme_access_ending, apps_api_readme_ownership_transfer, packages_db_readme_owner_fact, docs_adr_0004_collections_are_shared_by_membership_membership_sharing [EXTRACTED 1.00]
- **Client-Server Contract Wall** — packages_shared_readme_arcula_shared, packages_shared_readme_wire_types, packages_shared_readme_zod_schemas, apps_api_src_serialize, packages_db_readme_runtime_free_schema [INFERRED 0.85]
- **Arcula PDF Portfolio Template System** — docs_templates_pdf_arcula_pdf_template_arcula_pdf_template, docs_templates_pdf_artwork_page_artwork_page_template, docs_templates_pdf_artworks_grid_artworks_grid_template, docs_templates_pdf_artworks_grid_artwork_metadata_field_set, docs_templates_pdf_artwork_page_two_column_metadata_layout [INFERRED 0.85]
- **Arcula Visual Identity Assets** — apps_web_public_arcula_name_logo_arcula_wordmark, apps_web_public_icon_512_arcula_app_icon, apps_web_public_favicon_ink_splat_mark, apps_web_public_favicon_arcula_brand_identity [INFERRED 0.85]

## Communities (127 total, 21 thin omitted)

### Community 0 - "Artwork CSV Import"
Cohesion: 0.06
Nodes (50): EditableCell(), EditableCellProps, CsvImportPage(), ImportFileStep(), ImportFileStepProps, MAX_CSV_BYTES, ImportRunStep(), ImportRunStepProps (+42 more)

### Community 1 - "Media Object Keys"
Cohesion: 0.09
Nodes (54): loadArtworkById(), errorResponse(), param(), EXT_BY_TYPE, extensionFor(), finalBase(), finalDocumentKey(), finalDocumentPrefix() (+46 more)

### Community 2 - "Access Verdicts"
Cohesion: 0.07
Nodes (47): ArtworkFacts, audienceOf(), canReadArtworkDocuments(), canSeeArtwork(), canSeeCollection(), CollaboratorRow, CollectionFacts, hasPassword() (+39 more)

### Community 3 - "Invitations and Errors"
Cohesion: 0.07
Nodes (42): collectionRefusal(), requireMemberCollection(), requireOwnerCollection(), ApiError, ApiErrorCode, ApiErrorStatus, STATUS_BY_CODE, ADR-0005 (+34 more)

### Community 4 - "Password Hashing and Lambda"
Cohesion: 0.06
Nodes (37): CLIENT_ADDRESS_HEADER, clientAddress(), UNKNOWN_CLIENT_ADDRESS, decodeHex(), DEFAULT_SCRYPT_PARAMS, deriveKey(), encodeParams(), hashPassword() (+29 more)

### Community 5 - "Invitation API Tests"
Cohesion: 0.07
Nodes (36): emailProvider, hashInvitationToken(), InvitationFacts, isInvitationResendable(), mintInvitationToken(), resendCutoff(), ResendFacts, makeInvitation() (+28 more)

### Community 6 - "Public Collection State"
Cohesion: 0.08
Nodes (39): attemptMessage(), CollectionLockScreen(), CollectionLockScreenProps, ADR-0005, PublicArtworkPage(), ADR-0005, PublicCollectionPage(), ADR-0005 (+31 more)

### Community 7 - "Media Proxy Tests"
Cohesion: 0.07
Nodes (39): accessPath(), Account, collectionPath(), leavePath(), listPath(), makePdf(), removePath(), RUN (+31 more)

### Community 8 - "Artwork Documents"
Cohesion: 0.11
Nodes (32): DocumentRow(), DocumentRowProps, DocumentsUploader(), formatBytes(), isPdf(), StagedDropzone(), DocumentEntry, nextKey (+24 more)

### Community 9 - "Basicx Skin Options"
Cohesion: 0.10
Nodes (29): BasicxChrome(), BasicxChromeProps, FooterArtwork, BasicxSkin(), DescriptionContext, descriptionDismissed(), basicxSkin, BASICX_OPTION_SPECS (+21 more)

### Community 10 - "Public Page Tests"
Cohesion: 0.06
Nodes (26): commits, createArtwork, LocationProbe(), renderPage(), BarState, ready, AddressProbe(), collection (+18 more)

### Community 11 - "Auth Transport"
Cohesion: 0.10
Nodes (18): app, client, closeDb(), AuthBody, AuthUser, Cookie, API, ORIGIN (+10 more)

### Community 12 - "PDF Photo Pipeline"
Cohesion: 0.08
Nodes (24): AccessOutcome, CollectionPdfAccessError, fitInsideBox(), PixelSize, abortError(), browserPhotoEnv, browserSurface(), ConvertedPhoto (+16 more)

### Community 13 - "Wire Serialization"
Cohesion: 0.10
Nodes (31): CollectionAudience, mediaUrl(), ArtworkJoined, ArtworkRow, CollectionRow, DocumentRead, DocumentRow, extOf() (+23 more)

### Community 14 - "Image Variants"
Cohesion: 0.11
Nodes (24): base, get(), post(), ts, OBJECT_KEYS, generateVariants(), OrientedSource, orientSource() (+16 more)

### Community 15 - "Shared Payload Schemas"
Cohesion: 0.10
Nodes (29): grantHeld(), GRANT_COOKIE_PATH, GRANT_TTL_MS, grantCookieName(), GrantFacts, hashGrantToken(), isGrantUsable(), mintGrantToken() (+21 more)

### Community 16 - "Drizzle Schema Tests"
Cohesion: 0.08
Nodes (22): userColumns, ADR-0005, account, collectionAccessGrants, collections, collectionUnlockAttempts, schema, session (+14 more)

### Community 17 - "Artwork Form Fields"
Cohesion: 0.15
Nodes (27): ArtworkFields(), ArtworkFieldsProps, DocumentsUploaderProps, BAR_HEIGHT, FormActionsBar(), FormActionsBarProps, PhotoUploaderProps, ArtworkAddPage() (+19 more)

### Community 18 - "Collection Settings"
Cohesion: 0.15
Nodes (22): DataTab(), DataTabProps, GeneralTab(), GeneralTabProps, CollectionSettingsPage(), isSettingsTab(), SETTINGS_TABS, SettingsTab (+14 more)

### Community 19 - "Photo Uploader"
Cohesion: 0.14
Nodes (26): ImagePreviewModal(), ImagePreviewModalProps, labelFor(), PhotoUploader(), previewPhotoAt(), previewPhotoFor(), SortableTile(), SortableTileProps (+18 more)

### Community 20 - "Mail Templates"
Cohesion: 0.17
Nodes (23): accountMail(), AccountMailCopy, AccountMailFacts, INVITATION_DAYS, invitationMail(), InvitationMailFacts, MailCta, MailLayoutFacts (+15 more)

### Community 21 - "Protected Collection Tests"
Cohesion: 0.14
Nodes (18): db, access(), insertWork(), createWork(), expectRefusal(), err(), json(), req() (+10 more)

### Community 22 - "PDF Progress Bar"
Cohesion: 0.12
Nodes (22): PublicState, collectionPdfFileName(), COLLECTION_PDF, formatBytes(), NO_DETAIL, PdfBarCollection, PdfBarRun, PdfBarView (+14 more)

### Community 23 - "Collection PDF Document"
Cohesion: 0.16
Nodes (25): clean(), CollectionPdf(), EmptyPage(), FieldStack(), fieldValues(), fullFields(), GridBlock(), GridPage() (+17 more)

### Community 24 - "Manage Layout"
Cohesion: 0.15
Nodes (21): @tabler/icons-react@^3.48.0, MANAGE_HEADER_HEIGHT, ManageLayout(), ManageLayoutProps, ManageNavBar(), BarDetail(), CollectionPdfBar(), CollectionPdfPage() (+13 more)

### Community 25 - "Staged Uploads"
Cohesion: 0.13
Nodes (18): StagedDropzoneProps, StagedDropzoneWords, AddDocumentsResult, AddPhotosResult, nextKey, stageAndProcess(), StagedPhotoEntry, useArtworkPhotos() (+10 more)

### Community 26 - "Database Migrations"
Cohesion: 0.11
Nodes (21): "account", "artwork_documents", artwork_documents_artwork_id_idx, "artwork_photo_variants", "artwork_photos", artwork_photos_artwork_id_order_key, "artworks", artworks_collection_id_idx (+13 more)

### Community 27 - "Artwork Schema Types"
Cohesion: 0.10
Nodes (20): artworkCreateSchema, artworkUpdateSchema, optionalDate, optionalText, OutputIsWritable, SchemaAcceptsForm, StagedEntry, stagedEntrySchema (+12 more)

### Community 28 - "Shared Wire Schemas"
Cohesion: 0.10
Nodes (18): artworkStatusSchema, artworkDocumentReadSchema, artworkPhotoReadSchema, ArtworkWireIsArtwork, CollectionRead, collectionReadSchema, CollectionWireIsCollection, wireImageVariant (+10 more)

### Community 29 - "Save API Tests"
Cohesion: 0.10
Nodes (22): createArtwork(), dAa, dImg, dPdf, dZz, entry(), getArtwork(), listArtworks() (+14 more)

### Community 30 - "Access Card and Time"
Cohesion: 0.15
Nodes (16): AccessCard(), AccessCardProps, relative, relativeTime(), RelativeTimePart, relativeTimePart(), UNITS, NOW (+8 more)

### Community 31 - "DB Package Config"
Cohesion: 0.11
Nodes (20): dependencies, drizzle-orm@0.45.3, devDependencies, drizzle-kit@0.31.11, @types/node@24.19.1, vitest@5.0.2, exports, drizzle-orm (+12 more)

### Community 32 - "Mail Composition"
Cohesion: 0.16
Nodes (16): auth, firstNameOf(), userAdditionalFields, passwordResetMail(), verificationMail(), clientLink(), clientUrl(), clientOrigin (+8 more)

### Community 33 - "Web Package Config"
Cohesion: 0.10
Nodes (21): dependencies, better-auth@1.7.7, @dnd-kit/core@^6.3.1, @dnd-kit/utilities@^3.2.2, embla-carousel@^8.6.0, embla-carousel-react@^8.6.0, @mantine/core@^9.6.3, @mantine/form@^9.6.3 (+13 more)

### Community 34 - "Access Service Client"
Cohesion: 0.11
Nodes (15): accessService, leftSchema, removedSchema, access, Call, collectionAccessSchema, CollectionMember, collectionMemberSchema (+7 more)

### Community 35 - "Web Dev Dependencies"
Cohesion: 0.10
Nodes (20): devDependencies, jsdom@^30.1.1, @testing-library/jest-dom@^7.0.1, @testing-library/react@^16.3.3, @testing-library/user-event@^14.6.7, @types/jest@^30.0.0, @types/lodash@^4.17.25, @types/node@^26.6.3 (+12 more)

### Community 36 - "S3 Storage Layer"
Cohesion: 0.17
Nodes (13): kindOf(), getOr404(), rowMetadata(), BUCKET, copyObject(), headObject(), isObjectMissing(), objectBytes() (+5 more)

### Community 37 - "Artworks Table"
Cohesion: 0.15
Nodes (12): @mantine/modals@^9.6.3, ArtworksTable(), ArtworksTableProps, collator, RECORDS_PER_PAGE_OPTIONS, ArtworkThumbnail(), CollectionPage(), consoleError (+4 more)

### Community 38 - "Email Provider"
Cohesion: 0.24
Nodes (9): configuredReplyTo(), normalizeSender(), resendPayload(), sendHeaders(), createEmailProvider(), EmailMessage, EmailProvider, MailpitEmail (+1 more)

### Community 39 - "Collaborator Write Tests"
Cohesion: 0.16
Nodes (14): finalPhotoPrefix(), Account, collectionPath(), createWork(), listAs(), listPath(), RUN, share() (+6 more)

### Community 40 - "Ownership Transfer Tests"
Cohesion: 0.17
Nodes (14): sharedCollection(), makeCollection(), accessPath(), Account, collectionPath(), entry(), leavePath(), listPath() (+6 more)

### Community 41 - "Auth and Password Reset"
Cohesion: 0.22
Nodes (14): App(), CollectionPdfPage, AuthProvider(), toAuthError(), mapResetError(), ResetFailure, ResetPasswordPage(), ResetRequestPage() (+6 more)

### Community 42 - "Manage Page Tests"
Cohesion: 0.18
Nodes (11): useAuth(), ManagePage(), ADR-0004, collectionService, authState, collection, freeMe, getUserCollections (+3 more)

### Community 43 - "Invitation Inbox"
Cohesion: 0.16
Nodes (11): PendingInvitations(), ADR-0004, AcceptInvitationOutcome, invitationService, ADR-0004, wrongAccountDetailSchema, declinePendingInvitation, getPendingInvitations (+3 more)

### Community 44 - "Access Card Tests"
Cohesion: 0.13
Nodes (15): createInvitation, getAccess, invitation(), leaveCollection, LocationProbe(), MATE, NOW, OWNER (+7 more)

### Community 45 - "Community 45"
Cohesion: 0.12
Nodes (17): dependencies, @arcula/shared@workspace:*, @aws-sdk/client-s3@3.1146.0, better-auth@1.7.7, @better-auth/drizzle-adapter@1.7.7, drizzle-orm@0.45.3, hono@^4.13.12, sharp@^0.35.5 (+9 more)

### Community 46 - "Community 46"
Cohesion: 0.17
Nodes (10): CollectionPdfProps, buildCollectionPdfPlan(), collator, CollectionPdfPage, compareArtworks(), GRID_BLOCK_COUNT, idOrder(), isExportableArtwork() (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.17
Nodes (13): ARTWORK_LEFT_FIELDS, ARTWORK_RIGHT_FIELDS, artworksOnPage(), collectionPdfTexts(), FALLBACK_CHUNK_SIZE, IMAGE_UNAVAILABLE, METADATA_FIELDS, PHOTO_PRINT_BOX (+5 more)

### Community 48 - "Community 48"
Cohesion: 0.12
Nodes (9): getArtwork, hooks, renderPage(), restoreArtwork, updateArtwork, Call, ArtworkCreatePayload, ArtworkUpdatePayload (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.18
Nodes (12): applySetCookies(), cookieHeader(), INSTALLED, installStackFetch(), JAR, jar(), proxy(), resetStackSession() (+4 more)

### Community 50 - "Community 50"
Cohesion: 0.12
Nodes (16): compilerOptions, jsx, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals (+8 more)

### Community 51 - "Community 51"
Cohesion: 0.17
Nodes (15): devDependencies, fontkit@^2.0.4, @types/bun@^1.4.2, @types/fontkit@2.0.9, @types/nodemailer@^8.0.2, vitest@5.0.2, vitest, name (+7 more)

### Community 52 - "Community 52"
Cohesion: 0.16
Nodes (9): sql, repoRoot, repoRoot, s3, signedIn, signedUp, inCi, repoRoot (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.18
Nodes (11): activeSectionState, artwork(), collection, makeProps(), matches(), mediaQueryAnswer(), photo(), renderSkin() (+3 more)

### Community 54 - "Community 54"
Cohesion: 0.20
Nodes (12): canonicalRedirect(), healthBody(), noindexEnabled(), originHost(), accessRoutes, artworkMediaRoutes, artworkRoutes, collectionRoutes (+4 more)

### Community 55 - "Community 55"
Cohesion: 0.13
Nodes (14): @arcula/shared@workspace:*, dayjs@^1.11.23, @dnd-kit/sortable@^10.0.0, lodash@^4.18.1, zod@^4.6.5, @arcula/shared, zod, name (+6 more)

### Community 56 - "Community 56"
Cohesion: 0.14
Nodes (13): @mantine/carousel@^9.6.3, mantine-datatable@^9.4.0, @mantine/dates@^9.6.3, @mantine/dropzone@^9.6.3, react-dom@^19.3.0, root, CONTAINER_SIZES, mantineTheme (+5 more)

### Community 57 - "Community 57"
Cohesion: 0.19
Nodes (12): mapChangePasswordError(), ProfileForms(), ProfilePage(), ChangePasswordFormValues, changePasswordSchema, ProfileNameFormValues, profileNameSchema, authState (+4 more)

### Community 58 - "Community 58"
Cohesion: 0.25
Nodes (12): fallbackCharacters(), fallbackChunks(), CollectionPdfResult, exportCollection(), ExportOptions, loadFallbackFamilies(), registered, toDataUrl() (+4 more)

### Community 59 - "Community 59"
Cohesion: 0.14
Nodes (10): acceptInvitation, authState, collection, declinedRow, declineInvitation, getInvitation, LocationProbe(), preview (+2 more)

### Community 60 - "Community 60"
Cohesion: 0.13
Nodes (14): compilerOptions, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+6 more)

### Community 61 - "Community 61"
Cohesion: 0.13
Nodes (14): compilerOptions, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+6 more)

### Community 62 - "Community 62"
Cohesion: 0.14
Nodes (13): compilerOptions, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+5 more)

### Community 63 - "Community 63"
Cohesion: 0.30
Nodes (10): mapSignUpError(), SignUpPage(), EMPTY_SIGN_UP_FORM, SignUpFormValues, SignUpPayload, signUpSchema, toSignUpPayload(), LocationProbe() (+2 more)

### Community 64 - "Community 64"
Cohesion: 0.18
Nodes (10): Export ladder xxlarge to xlarge to original, The photo box is the whole free rectangle, SlideImage per-photo sizes and xxlarge srcSet candidate, The Collection PDF prints from its own variant, Margin at 0.75 in (54 pt), xxlarge variant at 3000 px, fitInsideBox, shouldWarnForLargeExport threshold (+2 more)

### Community 65 - "Community 65"
Cohesion: 0.16
Nodes (13): dependencies, zod@^4.6.5, devDependencies, vitest@5.0.2, exports, vitest, zod, name (+5 more)

### Community 66 - "Community 66"
Cohesion: 0.26
Nodes (10): cache, CacheEntry, createSubsetCache(), FONT_FILE, fontSubsetFor(), loadFace(), MAX_FALLBACK_CODE_POINTS, subsetCharacters() (+2 more)

### Community 67 - "Community 67"
Cohesion: 0.23
Nodes (10): Access Ending: Removal and Leaving, Pure Access Verdicts (access.ts), artworkRead.ts, Membership Loading (authorize.ts), 403 password-required Challenge, The Collection Gate, Sharing by Membership, Access grant (+2 more)

### Community 68 - "Community 68"
Cohesion: 0.20
Nodes (11): @arcula/api Backend, Bun and Lambda Entry Points, Uniform Error Envelope, Hono App (app.ts), /api/v1 Resource API, responsePolicy.ts, SPA Serving Middleware (spa.ts), SPA HTML Entry (index.html) (+3 more)

### Community 69 - "Community 69"
Cohesion: 0.23
Nodes (8): email/provider.ts, Invitation Loop, invitations.ts, Ownership Transfer, The Four Arcula Mails, Hosted Wordmark arcula-name-logo.png, collections.userId as the One Owner Fact, normalizeEmail

### Community 70 - "Community 70"
Cohesion: 0.29
Nodes (7): AuthContext, AuthContextType, ArculaUser, SessionUser, toArculaUser(), meService, SessionUserRead

### Community 71 - "Community 71"
Cohesion: 0.29
Nodes (8): LoginPage(), ProtectedRoute(), ProtectedRouteProps, ResetRequestState, resetRequestStateFor(), returnPathFrom(), ReturnState, returnStateFor()

### Community 72 - "Community 72"
Cohesion: 0.29
Nodes (9): Busy, InvitationView(), PageState, isNotFound(), InvitationAudience, invitationAudience(), InvitationViewer, normalizeEmail() (+1 more)

### Community 73 - "Community 73"
Cohesion: 0.24
Nodes (7): ApiRequestError, ApiRequestOptions, isDetailRecord(), toRequestError(), denied(), passwordRequired(), ADR-0005

### Community 74 - "Community 74"
Cohesion: 0.22
Nodes (7): media/keys.ts Object-Key Algebra, 0003_shared_collections Migration, 0004_media_namespace_not_null Migration, 0006_enable_rls Migration, Data Backfill Hand Edit, collections.mediaNamespaceId, Structural Contract Tests

### Community 75 - "Community 75"
Cohesion: 0.33
Nodes (9): PasswordControlInput, PasswordControlMode, passwordControlMode(), PasswordFormInput, PasswordWrite, resolvePasswordWrite(), ADR-0005, control() (+1 more)

### Community 76 - "Community 76"
Cohesion: 0.24
Nodes (9): Per-work isPublic flag (removed), Public / Private collection visibility, The collection gates; a work is published or draft, A password is a second condition on a public collection, Protected collection, A third visibility state public/private/protected (rejected), Collection PDF, Document metadata and the downloaded filename (+1 more)

### Community 77 - "Community 77"
Cohesion: 0.22
Nodes (10): x-arcula-client-ip Address, collectionPassword.ts, Password Write on PATCH /collections/:id, POST /collections/:id/unlock, Unlock Throttle, unlockThrottle.ts, collection_unlock_attempts Table, collectionUnlockSchema (+2 more)

### Community 78 - "Community 78"
Cohesion: 0.20
Nodes (9): Invitation Resend Rotation, media/pipeline.ts (Sharp), media/populations.ts, media/variants.ts Variant Geometry, @arcula/shared Client Contract, artworkPhotos.ts Order Invariant, caps.ts File Caps, invitationTime.ts (+1 more)

### Community 79 - "Community 79"
Cohesion: 0.44
Nodes (6): AppTitle(), AppTitleProps, ProductPage(), PublicNavBar(), @mantine/core, react

### Community 80 - "Community 80"
Cohesion: 0.24
Nodes (7): DeletedArtworksPage(), bulkRestoreMock, consoleError, getDeletedMock, renderPage(), restoreMock, SwitchingPage()

### Community 81 - "Community 81"
Cohesion: 0.29
Nodes (7): artwork(), collection, matches(), mediaQueryAnswer(), photo(), render(), renderSkin()

### Community 82 - "Community 82"
Cohesion: 0.22
Nodes (8): answer(), Call, collection, declined, inboxEntry, offer, preview, wrongAccount()

### Community 83 - "Community 83"
Cohesion: 0.20
Nodes (9): Artwork status: published or draft, The grant admits exactly what a visitor sees, isExportable: published and live only, Document ordering by Intl.Collator on artist, title, id, The no-photo 2x3 grid, Page count formula, US Letter page geometry in points, PDF page plan (buildCollectionPdfPlan) (+1 more)

### Community 84 - "Community 84"
Cohesion: 0.24
Nodes (10): Frontier Query, GitHub Issues via gh CLI, Native Issue Dependencies (Blocking), PRs as a Request Surface: No, Shared Issue/PR Number Space, Sub-Issues and Part-of Lines, Wayfinding Map and Child Tickets, Five Canonical Triage Roles (+2 more)

### Community 85 - "Community 85"
Cohesion: 0.22
Nodes (8): background_color, display, icons, name, scope, short_name, start_url, theme_color

### Community 86 - "Community 86"
Cohesion: 0.42
Nodes (8): apiRequest(), base(), discard(), process(), stage(), StagedOriginal, StagedVariants, ImageVariant

### Community 87 - "Community 87"
Cohesion: 0.22
Nodes (7): Merging is deploying, Preview environment per pull request (rejected), Two long-lived branches, two permanent environments, Arcula and ArculaDev stacks, CDKToolkit bootstrap, One AWS account and one CDK bootstrap for both environments, A second AWS account (rejected)

### Community 88 - "Community 88"
Cohesion: 0.25
Nodes (8): scripts, db:migrate, db:reset, db:seed, db:studio, dev, start, test

### Community 89 - "Community 89"
Cohesion: 0.25
Nodes (8): collectionGrants.ts, arcula_grant_{collectionId} Cookie, isPasswordProtected, role / ownerName on GET /collections, 0005_collection_passwords Migration, collection_access_grants Table, collections.passwordHash, Wire Types (types.ts)

### Community 90 - "Community 90"
Cohesion: 0.25
Nodes (5): vite@^8.3.1, @vitejs/plugin-react@^6.1.1, envDir, vite, @vitejs/plugin-react

### Community 91 - "Community 91"
Cohesion: 0.32
Nodes (4): authClient, renderApp(), requestPasswordReset, resetPassword

### Community 92 - "Community 92"
Cohesion: 0.43
Nodes (6): publicFailure(), AccessLost, accessRefusalOutcome(), collectionReadOutcome(), recheckCollectionAccess(), collection

### Community 93 - "Community 93"
Cohesion: 0.25
Nodes (7): Documents are never read by a visitor, Access is membership, collection_collaborators table, Collections are shared by membership, Conflict (409) error envelope for sharing state conflicts, The owner administers access, A read-only viewer role (rejected)

### Community 94 - "Community 94"
Cohesion: 0.43
Nodes (4): controlChars(), urlsIn(), DAYS, facts

### Community 95 - "Community 95"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../tsconfig.json

### Community 96 - "Community 96"
Cohesion: 0.29
Nodes (3): The tier cap counts owned collections, Transfer is immediate and leaves the previous owner as collaborator, collections.userId is the one owner fact

### Community 97 - "Community 97"
Cohesion: 0.29
Nodes (6): publicCollectionState locked branch, /collection/:collectionId/pdf viewer route, Manage page PDF entry-point button, ManageLayout shell with a header slot, pdfBarView and pdfFileSummary, publicFailure decides locked/private/error

### Community 98 - "Community 98"
Cohesion: 0.33
Nodes (5): @arcula/db Schema Package, Better Auth Core Tables, Nine Domain Tables, Partial Unique Pending-Invitation Index, collectionLimitForTier / COLLECTION_LIMITS

### Community 99 - "Community 99"
Cohesion: 0.33
Nodes (4): Collection lock screen (app chrome, not a skin), 403 password-required refusal with collectionName, CollectionLockScreen reused by the PDF viewer, Image unavailable placeholder page

### Community 100 - "Community 100"
Cohesion: 0.67
Nodes (6): Collection PDF Export, Arcula PDF Template, Artwork Page Template, Two-Column Metadata Layout, Artwork Metadata Field Set, Artworks Grid Template

### Community 101 - "Community 101"
Cohesion: 0.40
Nodes (5): scripts, build, dev, preview, test

### Community 102 - "Community 102"
Cohesion: 0.40
Nodes (4): Darker Grotesque static font faces, fontkit glyph-only subset (rejected), Noto Sans SC fallback face and font-fallback endpoint, GET /api/v1/pdf/font-fallback

### Community 103 - "Community 103"
Cohesion: 0.60
Nodes (3): COLLECTION_LIMITS, collectionLimitForTier(), CollectionTier

### Community 104 - "Community 104"
Cohesion: 0.67
Nodes (4): Arcula Wordmark, Arcula Brand Identity, Arcula Favicon (Ink Splat Mark), Arcula App Icon (512px)

### Community 107 - "Community 107"
Cohesion: 0.67
Nodes (3): "collection_access_grants", collection_access_grants_collection_id_idx, "collection_unlock_attempts"

## Ambiguous Edges - Review These
- `email/provider.ts` → `Email Opt-Out Deferred Until Complaints`  [AMBIGUOUS]
  docs/mail.md · relation: conceptually_related_to
- `Flag ADR Conflicts Explicitly` → `The Collection Gate`  [AMBIGUOUS]
  docs/agents/domain.md · relation: conceptually_related_to

## Knowledge Gaps
- **97 isolated node(s):** `ADR-0003`, `ADR-0005`, `ADR-0005`, `ADR-0004`, `ADR-0004` (+92 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 714 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Access grant` connect `Community 67` to `Community 98`, `Community 99`, `Community 68`, `Password Hashing and Lambda`, `Shared Payload Schemas`, `Community 89`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `ADR-0003`, `ADR-0005`, `ADR-0005` to the rest of the system?**
  _97 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Artwork CSV Import` be split into smaller, more focused modules?**
  _Cohesion score 0.06349206349206349 - nodes in this community are weakly interconnected._
- **Why does `react` connect `Community 79` to `Artwork CSV Import`, `Public Collection State`, `Artwork Documents`, `Basicx Skin Options`, `Public Page Tests`, `Artwork Form Fields`, `Collection Settings`, `Photo Uploader`, `Collection PDF Document`, `Manage Layout`, `Staged Uploads`, `Access Card and Time`, `Web Package Config`, `Artworks Table`, `Auth and Password Reset`, `Manage Page Tests`, `Invitation Inbox`, `Access Card Tests`, `Community 48`, `Community 53`, `Community 55`, `Community 56`, `Community 57`, `Community 58`, `Community 59`, `Community 63`, `Community 70`, `Community 71`, `Community 72`, `Community 80`, `Community 81`, `Community 91`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Should `Media Object Keys` be split into smaller, more focused modules?**
  _Cohesion score 0.08797814207650273 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `email/provider.ts` and `Email Opt-Out Deferred Until Complaints`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Flag ADR Conflicts Explicitly` and `The Collection Gate`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._