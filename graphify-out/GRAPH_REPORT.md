# Graph Report - arcula  (2026-11-07)

## Corpus Check
- 360 files · ~299,135 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .ttf 3, (none) 2, .ico 1)

## Summary
- 2674 nodes · 6429 edges · 161 communities (131 shown, 30 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 128 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `290a982e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dependencies
- Artwork
- CSV Import Flow
- Better Auth Web Client
- Media Keys and Pipeline
- CDK Stack and Provisioning
- Access Verdicts
- routes/invitations.ts
- Artwork Editor Forms
- react
- API Errors and Ownership Guards
- invitations.api.test.ts
- Public State and PDF Bar
- collaboratorRemoval.api.test.ts
- Access Grants and Unlock Throttle
- src/types.ts
- Row Serialization
- Artwork Shared Schemas
- Public Collection Loading
- PDF Photo Conversion
- Deploy Verify and Lambda Smoke
- transfer.api.test.ts
- collectionSettingsSave.ts
- Artworks Manage View Spec
- provider.ts
- Invitation Accept Page
- db/src/index.ts
- ArtworksList.tsx
- Deploy and Stack Scripts
- API Package Manifest
- Auth and Health API Tests
- Collection PDF Document
- Dev Setup Script
- App Env and Response Policy
- Public Pages and Lock Screen
- Database Migrations
- Photo Carousel and Basicx Section
- shared/src/index.ts
- Save API Tests
- Root Workspace Scripts
- Staged Upload Hooks
- Basicx Skin Options and Theme
- Drizzle Config Package
- mediaProxy.api.test.ts
- Invitation Web Service and Shared Schemas
- CDK Stack Core
- ESLint and Prettier Tooling
- Agent Working Guide
- Product Glossary
- PDF Font Subsetting
- PDF Preflight Layout
- Access Card Tests
- CDK Package Manifest
- devDependencies
- Web Test Stack Fixtures
- Web TypeScript Config
- Local Docker Stack
- Collection Search Predicate
- Smoke and Env Scripts
- Password and Grant Facts
- PDF Export Pipeline
- PDF Plan and Artwork Ordering
- Basicx Description Carousel
- @arcula/db Schema Package
- DB TypeScript Config
- Shared TypeScript Config
- Two Environments and Deploy
- req
- API TypeScript Config
- CollectionSettingsPage.tsx
- Basicx Skin Chrome
- PDF Export Decisions
- CDK TypeScript Config
- Shared Package Manifest
- Protected Collections
- Sharing and Invitations Glossary
- web/package.json
- Client Address and Lambda Entry
- Collection Password Hashing
- DocumentsUploader.tsx
- documentsUploader.test.tsx
- API Backend Overview
- Mail and Domain Docs
- DB Migration and Provision Scripts
- Collection Password Control
- Access Web Service
- relativeTime.ts
- DB Reset and S3 Scripts
- API Dev Dependencies
- Migrations and Object Keys
- Access Card and Invitation Time
- managePage.test.tsx
- Collection Gates Decisions
- artworkAddPage.test.tsx
- ESLint Config
- OIDC Provisioning
- Access Roles Glossary
- Membership Verdicts
- Basicx Skin Tests
- Invitation Service Tests
- Visitor Visibility Rules
- Issue Tracker Process
- 0005_collection_passwords Migration
- PWA Manifest
- utils/invitation.ts
- Photo Uploader
- vite.config.ts
- PDF Access Outcomes
- Media Service Client
- Branch Strategy Decisions
- CDK Build Config
- Branch and Docs Guide
- API Package Scripts
- Sharing ADR Cross-References
- Monorepo Layout Guide
- Agent Rules and gh Account
- artworkService.test.ts
- Arcula Icon Set
- Web Tests TypeScript Config
- Migrations and Rollback Decisions
- PDF Viewer and Lock Plan
- @dnd-kit/core
- Lock Screen Refusals
- PDF Template Designs
- Web Package Scripts
- PDF Font Choices
- Collection Tier Limits
- Port Check Script
- @arcula/shared Client Contract
- Arcula Brand Marks
- Invitation ADR Facts
- Domain Docs Guidance
- CDK Package Scripts
- Password Migration
- Env File Writer
- Subset Font Types
- Web Test Env Types
- Deploy Overview
- Access and Inbox Routes
- Soft Deleted Works
- Web Env Types
- Secrets Scoping Decisions
- Password Validity Rules
- Column Type Conventions
- Dev Deploy Wrapper
- Prod Deploy Wrapper
- CLAUDE.md Mirror
- S3 Storage Client
- Better Auth Skill Reference
- Collection List With Role
- Password Protection Plan
- @dnd-kit/utilities
- embla-carousel-react@^8.6.0
- lodash
- papaparse
- react-dom

## God Nodes (most connected - your core abstractions)
1. `react` - 92 edges
2. `@mantine/core` - 81 edges
3. `react-router-dom` - 55 edges
4. `ApiError` - 47 edges
5. `req()` - 47 edges
6. `Artwork` - 44 edges
7. `Collection` - 36 edges
8. `ApiRequestError` - 28 edges
9. `collectionSlug()` - 28 edges
10. `db` - 27 edges

## Surprising Connections (you probably didn't know these)
- `arcula_grant_{collectionId} Cookie` --semantically_similar_to--> `Access grant`  [INFERRED] [semantically similar]
  apps/api/README.md → docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md
- `artwork_photo_variants (parentId, key) Upsert` --semantically_similar_to--> `Single-Transaction Save with Accepted Residual`  [INFERRED] [semantically similar]
  packages/db/README.md → apps/api/README.md
- `BasicxSectionProps` --references--> `Artwork`  [EXTRACTED]
  apps/web/src/skins/basicx/BasicxSection.tsx → packages/shared/src/types.ts
- `ArtworksListProps` --references--> `Artwork`  [EXTRACTED]
  apps/web/src/components/manage/collection/ArtworksList.tsx → packages/shared/src/types.ts
- `Artworks Manage View` --conceptually_related_to--> `Skins (Public Collection Pages)`  [INFERRED]
  docs/specs/artworks-manage-view.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Collection Access and Visibility Model** — readme_the_collection_is_the_only_gate, readme_protected_collection, readme_access_grant, readme_lock_screen, readme_collection_collaborators, readme_media_proxy [EXTRACTED 1.00]
- **Collection Access and Visibility Model** — readme_the_collection_is_the_only_gate, readme_protected_collection, readme_access_grant, readme_lock_screen, readme_collection_collaborators, readme_media_proxy [EXTRACTED 1.00]
- **Forward-Only Release Discipline (branches, deploys, migrations)** — agents_arcula_two_branches_two_environments, agents_arcula_merging_is_deploying, agents_arcula_migrations_forward_only, agents_arcula_schema_change_ships_alone, agents_arcula_deploy_script, agents_arcula_shared_collections_migration [EXTRACTED 1.00]
- **Forward-Only Release Discipline (branches, deploys, migrations)** — agents_arcula_two_branches_two_environments, agents_arcula_merging_is_deploying, agents_arcula_migrations_forward_only, agents_arcula_schema_change_ships_alone, agents_arcula_deploy_script, agents_arcula_shared_collections_migration [EXTRACTED 1.00]
- **Arcula Icon Family (one splash mark across four sizes and two polarities)** — apps_web_public_favicon_32, apps_web_public_apple_touch_icon, apps_web_public_icon_192, apps_web_public_icon_maskable_512, arcula_splash_mark [EXTRACTED 1.00]
- **Arcula Icon Family (one splash mark across four sizes and two polarities)** — apps_web_public_favicon_32, apps_web_public_apple_touch_icon, apps_web_public_icon_192, apps_web_public_icon_maskable_512, arcula_splash_mark [EXTRACTED 1.00]
- **Protected Collection Unlock Flow** — agents_arcula_protected_collection, agents_arcula_unlock_route, agents_arcula_access_grant, agents_arcula_collection_grants_module, agents_arcula_unlock_throttle, agents_arcula_client_address, agents_arcula_lock_screen [EXTRACTED 1.00]
- **Protected Collection Unlock Flow** — agents_arcula_protected_collection, agents_arcula_unlock_route, agents_arcula_access_grant, agents_arcula_collection_grants_module, agents_arcula_unlock_throttle, agents_arcula_client_address, agents_arcula_lock_screen [EXTRACTED 1.00]
- **Components Sharing One Manage-View State** — docs_specs_artworks_manage_view_user_settings, docs_specs_artworks_manage_view_shared_sort_state, docs_specs_artworks_manage_view_selection, docs_specs_artworks_manage_view_table, docs_specs_artworks_manage_view_grid, docs_specs_artworks_manage_view_toolbar [EXTRACTED 1.00]
- **Components Sharing One Manage-View State** — docs_specs_artworks_manage_view_user_settings, docs_specs_artworks_manage_view_shared_sort_state, docs_specs_artworks_manage_view_selection, docs_specs_artworks_manage_view_table, docs_specs_artworks_manage_view_grid, docs_specs_artworks_manage_view_toolbar [EXTRACTED 1.00]
- **Collection password protection: unlock route, grant cookie, verdict, throttle** — docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_protected_collection, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_unlock_route, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_access_grant, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_unlock_throttle, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_lock_screen, apps_api_src_collectiongrants, apps_api_src_collectionpassword [EXTRACTED 1.00]
- **Collection PDF export pipeline: page plan, photo pipeline, geometry, fonts, viewer** — docs_specs_pdf_export_collection_pdf, docs_specs_pdf_export_page_plan, docs_specs_pdf_export_photo_pipeline, docs_specs_pdf_export_page_geometry, docs_specs_pdf_export_noto_sans_sc_fallback, docs_specs_pdf_export_collection_pdf_page_route [EXTRACTED 1.00]
- **First-Run Infrastructure Sequence** — infra_cdk_readme_first_run_order, infra_cdk_readme_cdk_bootstrap, infra_cdk_readme_cert_provision, infra_cdk_readme_context_values, infra_cdk_readme_public_url_two_step, infra_cdk_readme_www_domain_pair [EXTRACTED 1.00]
- **First-Run Infrastructure Sequence** — infra_cdk_readme_first_run_order, infra_cdk_readme_cdk_bootstrap, infra_cdk_readme_cert_provision, infra_cdk_readme_context_values, infra_cdk_readme_public_url_two_step, infra_cdk_readme_www_domain_pair [EXTRACTED 1.00]
- **Protected Collection Unlock Flow** — apps_api_readme_unlock_route, apps_api_readme_grant_cookie, apps_api_readme_collection_grants_module, apps_api_readme_unlock_throttle, packages_db_readme_access_grants_table, packages_db_readme_unlock_attempts_table, docs_adr_0005_a_password_is_a_second_condition_on_a_public_collection_access_grant [EXTRACTED 1.00]
- **Protected Collection Unlock Flow** — project_plan_protected_collection_second_condition, project_plan_collection_access_grants_table, project_plan_grant_cookie_scoping, project_plan_unlock_throttle, project_plan_collection_unlock_attempts_table, project_plan_lock_screen_as_state [EXTRACTED 1.00]
- **Protected Collection Unlock Flow** — project_plan_protected_collection_second_condition, project_plan_collection_access_grants_table, project_plan_grant_cookie_scoping, project_plan_unlock_throttle, project_plan_collection_unlock_attempts_table, project_plan_lock_screen_as_state [EXTRACTED 1.00]
- **Collection Sharing Lifecycle** — apps_api_readme_access_ts_verdicts, apps_api_readme_authorize_ts, apps_api_readme_invitation_loop, apps_api_readme_access_read, apps_api_readme_access_ending, apps_api_readme_ownership_transfer, packages_db_readme_owner_fact, docs_adr_0004_collections_are_shared_by_membership_membership_sharing [EXTRACTED 1.00]
- **Arcula PDF Portfolio Template System** — docs_templates_pdf_arcula_pdf_template_arcula_pdf_template, docs_templates_pdf_artwork_page_artwork_page_template, docs_templates_pdf_artworks_grid_artworks_grid_template, docs_templates_pdf_artworks_grid_artwork_metadata_field_set, docs_templates_pdf_artwork_page_two_column_metadata_layout [INFERRED 0.85]
- **The Sharing-by-Membership Model (owner, collaborator, invitation, transfer)** — agents_arcula_sharing_is_membership, glossary_owner, glossary_collaborator, glossary_invitation, glossary_ownership_transfer, agents_arcula_invitation, agents_arcula_two_mails_best_effort, agents_arcula_access_administration_boundary, agents_arcula_media_namespace [INFERRED 0.85]
- **The Sharing-by-Membership Model (owner, collaborator, invitation, transfer)** — agents_arcula_sharing_is_membership, glossary_owner, glossary_collaborator, glossary_invitation, glossary_ownership_transfer, agents_arcula_invitation, agents_arcula_two_mails_best_effort, agents_arcula_access_administration_boundary, agents_arcula_media_namespace [INFERRED 0.85]
- **Arcula Visual Identity Assets** — apps_web_public_arcula_name_logo_arcula_wordmark, apps_web_public_icon_512_arcula_app_icon, apps_web_public_favicon_ink_splat_mark, apps_web_public_favicon_arcula_brand_identity [INFERRED 0.85]
- **Grid Rendering Pipeline** — docs_specs_artworks_manage_view_grid, docs_specs_artworks_manage_view_artwork_card, docs_specs_artworks_manage_view_masonry_span_grid, docs_specs_artworks_manage_view_sorted_then_paged [INFERRED 0.85]
- **Grid Rendering Pipeline** — docs_specs_artworks_manage_view_grid, docs_specs_artworks_manage_view_artwork_card, docs_specs_artworks_manage_view_masonry_span_grid, docs_specs_artworks_manage_view_sorted_then_paged [INFERRED 0.85]
- **Client-Server Contract Wall** — packages_shared_readme_arcula_shared, packages_shared_readme_wire_types, packages_shared_readme_zod_schemas, apps_api_src_serialize, packages_db_readme_runtime_free_schema [INFERRED 0.85]
- **Forward-only schema: migration releases ship alone before the code that reads them** — docs_adr_0001_two_branches_two_environments_rollback_by_revert_commit, docs_adr_0004_collections_are_shared_by_membership_forward_only_schema_two_migrations, docs_plans_collection_passwords_plan_release_1_schema_alone, docs_plans_collection_passwords_plan_migration_0005_collection_passwords [INFERRED 0.85]
- **Media Object Lifecycle: Key Algebra, Stage/Process/Save, Proxy, Lifecycle Rule** — project_plan_object_key_algebra, project_plan_media_stage_process_save, project_plan_variant_geometry, project_plan_artwork_photo_variants_table, project_plan_media_proxy_route, infra_cdk_readme_media_bucket [INFERRED 0.85]
- **Media Object Lifecycle: Key Algebra, Stage/Process/Save, Proxy, Lifecycle Rule** — project_plan_object_key_algebra, project_plan_media_stage_process_save, project_plan_variant_geometry, project_plan_artwork_photo_variants_table, project_plan_media_proxy_route, infra_cdk_readme_media_bucket [INFERRED 0.85]

## Communities (161 total, 30 thin omitted)

### Community 0 - "dependencies"
Cohesion: 0.10
Nodes (20): dependencies, better-auth@1.7.7, @dnd-kit/sortable@^10.0.0, embla-carousel@^8.6.0, @mantine/core@^9.6.3, @mantine/dates@^9.6.3, @mantine/dropzone@^9.6.3, @mantine/form@^9.6.3 (+12 more)

### Community 1 - "Artwork"
Cohesion: 0.05
Nodes (37): SkinHostProps, PublicArtworkData, PublicCollectionData, ExportData, SkinProps, SkinView, ListProps, AddressProbe() (+29 more)

### Community 2 - "CSV Import Flow"
Cohesion: 0.06
Nodes (50): mantine-datatable@^9.4.0, EditableCell(), EditableCellProps, CsvImportPage(), ImportFileStep(), ImportFileStepProps, MAX_CSV_BYTES, ImportRunStep() (+42 more)

### Community 3 - "Better Auth Web Client"
Cohesion: 0.08
Nodes (40): AuthContextType, authClient, toAuthError(), ArculaUser, SessionUser, toArculaUser(), mapResetError(), ResetFailure (+32 more)

### Community 4 - "Media Keys and Pipeline"
Cohesion: 0.08
Nodes (55): Tx, EXT_BY_TYPE, extensionFor(), finalBase(), finalDocumentKey(), finalDocumentPrefix(), finalPhotoKey(), finalPhotoPrefix() (+47 more)

### Community 5 - "CDK Stack and Provisioning"
Cohesion: 0.05
Nodes (48): ApiFunction (nodejs24.x arm64 Lambda serving Hono + SPA), ArculaStack (one class, instantiated per environment), CDK Bootstrap (once, by an admin identity), CDK Package Commands and Non-Workspace Status, Certificate Provisioning in us-east-1, Stack Context Values (-c KEY=value), First-Run Provisioning Order, Api — HTTP API with one greedy /{proxy+} ANY route (+40 more)

### Community 6 - "Access Verdicts"
Cohesion: 0.07
Nodes (47): ArtworkFacts, audienceOf(), canReadArtworkDocuments(), canSeeArtwork(), canSeeCollection(), CollaboratorRow, CollectionFacts, hasPassword() (+39 more)

### Community 7 - "routes/invitations.ts"
Cohesion: 0.06
Nodes (41): clientLink(), clientUrl(), EmailProvider, emailProvider, replyToConfigured, hashInvitationToken(), InvitationFacts, isInvitationResendable() (+33 more)

### Community 8 - "Artwork Editor Forms"
Cohesion: 0.10
Nodes (30): ArtworkFields(), ArtworkFieldsProps, BAR_HEIGHT, FormActionsBar(), FormActionsBarProps, PhotoUploader(), ArtworkAddPage(), ArtworkEditPage() (+22 more)

### Community 9 - "react"
Cohesion: 0.17
Nodes (15): AppTitle(), AppTitleProps, MANAGE_HEADER_HEIGHT, ManageLayout(), ManageLayoutProps, ManageNavBar(), ProductPage(), PublicNavBar() (+7 more)

### Community 10 - "API Errors and Ownership Guards"
Cohesion: 0.09
Nodes (35): requireMemberArtwork(), requireMemberCollection(), requireOwnerCollection(), ApiError, ApiErrorCode, ApiErrorStatus, errorResponse(), STATUS_BY_CODE (+27 more)

### Community 11 - "invitations.api.test.ts"
Cohesion: 0.16
Nodes (18): headerValue(), linkIn(), MailpitAddress, MailpitFullMessage, mailpitHeaders(), mailpitHtml(), MailpitMessage, mailpitMessage() (+10 more)

### Community 12 - "Public State and PDF Bar"
Cohesion: 0.09
Nodes (38): PublicState, BarDetail(), CollectionPdfBar(), CollectionPdfPage(), isMobileLayout(), LoadState, mobileQueries(), readCollection() (+30 more)

### Community 13 - "collaboratorRemoval.api.test.ts"
Cohesion: 0.17
Nodes (12): accessPath(), Account, collectionPath(), leavePath(), listPath(), makePdf(), removePath(), RUN (+4 more)

### Community 14 - "Access Grants and Unlock Throttle"
Cohesion: 0.06
Nodes (43): grantHeld(), GRANT_COOKIE_PATH, GRANT_TTL_MS, grantCookieName(), GrantFacts, hashGrantToken(), isGrantUsable(), mintGrantToken() (+35 more)

### Community 15 - "src/types.ts"
Cohesion: 0.16
Nodes (17): documentsChanged(), isAcceptedDocumentType(), isDocumentImageType(), sortDocuments(), fileDocument, imageDocument, ACCEPTED_DOCUMENT_TYPES, isAcceptedImageType() (+9 more)

### Community 16 - "Row Serialization"
Cohesion: 0.09
Nodes (31): CollectionAudience, ArtworkJoined, ArtworkRow, CollectionRow, DocumentRead, DocumentRow, extOf(), InvitationRow (+23 more)

### Community 17 - "Artwork Shared Schemas"
Cohesion: 0.08
Nodes (26): ArtworkCreatePayload, artworkCreateSchema, artworkSchema, artworkStatusSchema, artworkUpdateSchema, optionalDate, optionalText, OutputIsWritable (+18 more)

### Community 18 - "Public Collection Loading"
Cohesion: 0.10
Nodes (25): attemptMessage(), CollectionLockScreenProps, ADR-0005, byTitle(), loadArtwork(), loadCollection(), lockDetails, publicArtworkState() (+17 more)

### Community 19 - "PDF Photo Conversion"
Cohesion: 0.09
Nodes (22): AccessOutcome, fitInsideBox(), PixelSize, browserPhotoEnv, browserSurface(), ConvertedPhoto, convertPhoto(), MediaRefusal (+14 more)

### Community 20 - "Deploy Verify and Lambda Smoke"
Cohesion: 0.10
Nodes (25): base, get(), post(), ts, OBJECT_KEYS, generateVariants(), OrientedSource, orientSource() (+17 more)

### Community 21 - "transfer.api.test.ts"
Cohesion: 0.19
Nodes (12): accessPath(), Account, collectionPath(), entry(), leavePath(), listPath(), removePath(), RUN (+4 more)

### Community 22 - "collectionSettingsSave.ts"
Cohesion: 0.26
Nodes (8): PublicTabProps, GeneralLoadedValues, GeneralSaveDecision, PublicEditedValues, PublicLoadedValues, resolvePublicSave(), skinOptionsChanged(), SkinOptionValue

### Community 23 - "Artworks Manage View Spec"
Cohesion: 0.08
Nodes (27): ArtworkCard, Artworks Manage View, Grid (artwork card view), Measured CSS-grid Masonry, Shared Selection, Shared Sort State, Sort Whole Collection, Then Page, Table (artwork table view) (+19 more)

### Community 24 - "provider.ts"
Cohesion: 0.09
Nodes (39): auth, firstNameOf(), accountMail(), AccountMailCopy, AccountMailFacts, passwordResetMail(), verificationMail(), INVITATION_DAYS (+31 more)

### Community 25 - "Invitation Accept Page"
Cohesion: 0.09
Nodes (24): AuthContext, useAuth(), LoginPage(), Busy, InvitationPage(), InvitationView(), PageState, ProtectedRoute() (+16 more)

### Community 26 - "db/src/index.ts"
Cohesion: 0.07
Nodes (36): userAdditionalFields, db, access(), userColumns, insertWork(), ADR-0005, listPath(), searchPath() (+28 more)

### Community 27 - "ArtworksList.tsx"
Cohesion: 0.06
Nodes (48): ArtworkCard(), ArtworkCardProps, artworkCardAspect(), artworkCardSpan(), ASPECT_MAX, ASPECT_MIN, ArtworkCardItem(), ArtworksGrid() (+40 more)

### Community 28 - "Deploy and Stack Scripts"
Cohesion: 0.13
Nodes (18): build-lambda.sh script, host_resolves(), print_dns_records(), deploy.sh script, ensure-api.sh script, load_env(), require_env(), environment.sh script (+10 more)

### Community 29 - "API Package Manifest"
Cohesion: 0.10
Nodes (25): dependencies, @arcula/db@workspace:*, @arcula/shared@workspace:*, @aws-sdk/client-s3@3.1146.0, better-auth@1.7.7, @better-auth/drizzle-adapter@1.7.7, drizzle-orm@0.45.3, hono@^4.13.12 (+17 more)

### Community 30 - "Auth and Health API Tests"
Cohesion: 0.12
Nodes (5): client, closeDb(), AuthBody, AuthUser, Cookie

### Community 31 - "Collection PDF Document"
Cohesion: 0.15
Nodes (26): clean(), CollectionPdf(), EmptyPage(), FieldStack(), fieldValues(), fullFields(), GridBlock(), GridPage() (+18 more)

### Community 32 - "Dev Setup Script"
Cohesion: 0.17
Nodes (24): ask(), ask_secret(), banner(), _clear(), confirm(), _env_write(), environment_facts(), _existing() (+16 more)

### Community 33 - "App Env and Response Policy"
Cohesion: 0.10
Nodes (23): clientOrigin, corsOrigins, deployedCommit, noindexFlag, useSecureCookies, canonicalRedirect(), healthBody(), noindexEnabled() (+15 more)

### Community 34 - "Public Pages and Lock Screen"
Cohesion: 0.17
Nodes (23): App(), CollectionPdfPage, AuthProvider(), CollectionLockScreen(), PublicArtworkPage(), ADR-0005, PublicCollectionPage(), ADR-0005 (+15 more)

### Community 35 - "Database Migrations"
Cohesion: 0.11
Nodes (21): "account", "artwork_documents", artwork_documents_artwork_id_idx, "artwork_photo_variants", "artwork_photos", artwork_photos_artwork_id_order_key, "artworks", artworks_collection_id_idx (+13 more)

### Community 36 - "Photo Carousel and Basicx Section"
Cohesion: 0.22
Nodes (17): BasicxSection(), BasicxSectionProps, chevronCursor(), emblaDuration(), SlideImage(), slideSizes(), photoOrderChanged(), photoSrcSet() (+9 more)

### Community 37 - "shared/src/index.ts"
Cohesion: 0.08
Nodes (24): DeletedArtworksPage(), LoadFailure, artworkService, consoleError, ListTree(), renderList(), softDeleteMock, collection (+16 more)

### Community 38 - "Save API Tests"
Cohesion: 0.09
Nodes (26): insertWork(), createWork(), uuid(), createArtwork(), dAa, dImg, dPdf, dZz (+18 more)

### Community 39 - "Root Workspace Scripts"
Cohesion: 0.09
Nodes (23): scripts, build, check, db:migrate, db:reset, db:seed, db:studio, dev (+15 more)

### Community 40 - "Staged Upload Hooks"
Cohesion: 0.19
Nodes (15): StagedDropzoneProps, StagedDropzoneWords, AddDocumentsResult, UseArtworkDocumentsOptions, AddPhotosResult, nextKey, stageAndProcess(), StagedPhotoEntry (+7 more)

### Community 41 - "Basicx Skin Options and Theme"
Cohesion: 0.16
Nodes (20): basicxSkin, BASICX_OPTION_SPECS, BasicxOptions, basicxOptions(), DEFAULTS, read(), basicxTheme, DEFAULT_SKIN (+12 more)

### Community 42 - "Drizzle Config Package"
Cohesion: 0.11
Nodes (20): dependencies, drizzle-orm@0.45.3, devDependencies, drizzle-kit@0.31.11, @types/node@24.19.1, vitest@5.0.2, exports, drizzle-orm (+12 more)

### Community 43 - "mediaProxy.api.test.ts"
Cohesion: 0.08
Nodes (36): mediaUrl(), stageAndProcess(), stageAndProcessPhoto(), makeJpeg(), processEntry(), stageDocument(), stageEntry(), stagePhoto() (+28 more)

### Community 44 - "Invitation Web Service and Shared Schemas"
Cohesion: 0.11
Nodes (15): AcceptInvitationOutcome, ADR-0004, wrongAccountDetailSchema, declinePendingInvitation, getPendingInvitations, renderList(), ADR-0004, InvitationCreatePayload (+7 more)

### Community 45 - "CDK Stack Core"
Cohesion: 0.19
Nodes (10): ArculaStack, ArculaStackProps, EnvironmentConfig, EnvironmentName, ENVIRONMENTS, parseEnvironment(), app, environment (+2 more)

### Community 46 - "ESLint and Prettier Tooling"
Cohesion: 0.14
Nodes (18): devDependencies, @eslint/js@^10.0.1, eslint-plugin-format@^2.0.1, eslint-plugin-react-hooks@^7.1.1, prettier@^3.9.9, typescript@^6.0.3, typescript-eslint@^8.70.1, typescript (+10 more)

### Community 47 - "Agent Working Guide"
Cohesion: 0.13
Nodes (18): The Boundary Is Access Administration, access.ts (access verdicts), artworkRead.ts (the single read path for Artworks), authorize.ts (loads rows, asks the write question), Collection Search (ten-field predicate, member-only), Component Tests Need an Explicit afterEach(cleanup), Correctness Floor (the test exception), deploy-verify.ts (17-step end-to-end pass) (+10 more)

### Community 48 - "Product Glossary"
Cohesion: 0.16
Nodes (18): media/populations.ts (photos vs documents), Acquisition Date, Acquisition Price, Artwork, Artwork Document, Artwork Photo, Collection, Collection PDF (+10 more)

### Community 49 - "PDF Font Subsetting"
Cohesion: 0.18
Nodes (12): cache, CacheEntry, createSubsetCache(), FONT_FILE, fontSubsetFor(), loadFace(), MAX_FALLBACK_CODE_POINTS, SubsetCache (+4 more)

### Community 50 - "PDF Preflight Layout"
Cohesion: 0.18
Nodes (12): ARTWORK_LEFT_FIELDS, artworksOnPage(), collectionPdfTexts(), FALLBACK_CHUNK_SIZE, IMAGE_UNAVAILABLE, METADATA_FIELDS, PHOTO_PRINT_BOX, PhotoPlacement (+4 more)

### Community 51 - "Access Card Tests"
Cohesion: 0.13
Nodes (15): createInvitation, getAccess, invitation(), leaveCollection, LocationProbe(), MATE, NOW, OWNER (+7 more)

### Community 52 - "CDK Package Manifest"
Cohesion: 0.15
Nodes (17): dependencies, aws-cdk-lib@^2.200.0, constructs@^10.4.2, devDependencies, aws-cdk@^2.200.0, @types/node@^20.14.0, typescript@^5.6.0, vitest@5.0.2 (+9 more)

### Community 53 - "devDependencies"
Cohesion: 0.10
Nodes (20): devDependencies, jsdom@^30.1.1, @testing-library/jest-dom@^7.0.1, @testing-library/react@^16.3.3, @testing-library/user-event@^14.6.7, @types/jest@^30.0.0, @types/lodash@^4.17.25, @types/node@^26.6.3 (+12 more)

### Community 54 - "Web Test Stack Fixtures"
Cohesion: 0.18
Nodes (12): applySetCookies(), cookieHeader(), INSTALLED, installStackFetch(), JAR, jar(), proxy(), resetStackSession() (+4 more)

### Community 55 - "Web TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, jsx, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals (+8 more)

### Community 56 - "Local Docker Stack"
Cohesion: 0.12
Nodes (16): POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, interval, retries, test, timeout, environment (+8 more)

### Community 57 - "Collection Search Predicate"
Cohesion: 0.19
Nodes (14): acquisitionDateText(), ARTWORK_SEARCH_FIELDS, ArtworkSearchField, ArtworkSearchText, isBlankSearchQuery(), MAX_SEARCH_QUERY_LENGTH, MAX_SEARCH_TERMS, MONTH_NAMES (+6 more)

### Community 58 - "Smoke and Env Scripts"
Cohesion: 0.12
Nodes (9): ./index.js, variables, cookie, dist, expectStatus(), fail(), started, t (+1 more)

### Community 59 - "Password and Grant Facts"
Cohesion: 0.22
Nodes (10): x-arcula-client-ip Address, collectionPassword.ts, Password Write on PATCH /collections/:id, POST /collections/:id/unlock, Unlock Throttle, unlockThrottle.ts, collection_unlock_attempts Table, collectionUnlockSchema (+2 more)

### Community 60 - "PDF Export Pipeline"
Cohesion: 0.23
Nodes (13): fallbackCharacters(), fallbackChunks(), CollectionPdfResult, exportCollection(), ExportOptions, loadFallbackFamilies(), registered, toDataUrl() (+5 more)

### Community 61 - "PDF Plan and Artwork Ordering"
Cohesion: 0.14
Nodes (12): ImagePreviewModalProps, CollectionPdfProps, buildCollectionPdfPlan(), collator, CollectionPdfPage, compareArtworks(), GRID_BLOCK_COUNT, idOrder() (+4 more)

### Community 62 - "Basicx Description Carousel"
Cohesion: 0.18
Nodes (11): activeSectionState, artwork(), collection, makeProps(), matches(), mediaQueryAnswer(), photo(), renderSkin() (+3 more)

### Community 63 - "@arcula/db Schema Package"
Cohesion: 0.33
Nodes (5): @arcula/db Schema Package, Better Auth Core Tables, Nine Domain Tables, Partial Unique Pending-Invitation Index, collectionLimitForTier / COLLECTION_LIMITS

### Community 64 - "DB TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+6 more)

### Community 65 - "Shared TypeScript Config"
Cohesion: 0.13
Nodes (14): compilerOptions, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+6 more)

### Community 66 - "Two Environments and Deploy"
Cohesion: 0.19
Nodes (14): One AWS Account, One CDK Bootstrap (ADR-0002), check.yml (the gate), scripts/deploy.sh (the one deploy sequence), dev Environment (dev.arcula.art), infra/cdk (the CDK stack, not a workspace member), Merging Is Deploying, Migrations Are Forward-Only, Rule: Never Commit a Secret (+6 more)

### Community 67 - "req"
Cohesion: 0.11
Nodes (29): app, Account, collectionPath(), createWork(), listAs(), listPath(), RUN, share() (+21 more)

### Community 68 - "API TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+5 more)

### Community 69 - "CollectionSettingsPage.tsx"
Cohesion: 0.22
Nodes (13): DataTab(), DataTabProps, GeneralTab(), CollectionSettingsPage(), isSettingsTab(), SETTINGS_TABS, SettingsTab, TAB_LABELS (+5 more)

### Community 70 - "Basicx Skin Chrome"
Cohesion: 0.23
Nodes (9): BasicxChrome(), BasicxChromeProps, FooterArtwork, BasicxSkin(), DescriptionContext, descriptionDismissed(), ActiveSection, useActiveSection() (+1 more)

### Community 71 - "PDF Export Decisions"
Cohesion: 0.18
Nodes (10): Export ladder xxlarge to xlarge to original, The photo box is the whole free rectangle, SlideImage per-photo sizes and xxlarge srcSet candidate, The Collection PDF prints from its own variant, Margin at 0.75 in (54 pt), xxlarge variant at 3000 px, fitInsideBox, shouldWarnForLargeExport threshold (+2 more)

### Community 72 - "CDK TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, lib, module, moduleResolution, noEmit, noUnusedLocals, noUnusedParameters (+5 more)

### Community 73 - "Shared Package Manifest"
Cohesion: 0.16
Nodes (13): dependencies, zod@^4.6.5, devDependencies, vitest@5.0.2, exports, vitest, zod, name (+5 more)

### Community 74 - "Protected Collections"
Cohesion: 0.23
Nodes (13): Access Grant, collectionGrants.ts (grant facts), collectionPassword.ts (hashPassword, verifyPassword), Lock Screen (app chrome, not a skin), Protected Collection (a second condition, not a third state), A Skin Must Not Use a Portaled Mantine Component, POST /collections/:id/unlock, Access Grant (glossary sense) (+5 more)

### Community 75 - "Sharing and Invitations Glossary"
Cohesion: 0.18
Nodes (13): Collection Invitation, invitations.ts (token algebra and row questions), Media Namespace (mediaNamespaceId), Two Mails, Best Effort, Account Mail, Invitation, Invitee, Ownership Transfer (+5 more)

### Community 76 - "web/package.json"
Cohesion: 0.15
Nodes (12): @arcula/shared@workspace:*, dayjs@^1.11.23, @mantine/carousel@^9.6.3, zod@^4.6.5, @arcula/shared, zod, name, private (+4 more)

### Community 77 - "Client Address and Lambda Entry"
Cohesion: 0.26
Nodes (7): CLIENT_ADDRESS_HEADER, clientAddress(), UNKNOWN_CLIENT_ADDRESS, GatewayEvent, gatewayHeaders(), handler(), GwOpts

### Community 78 - "Collection Password Hashing"
Cohesion: 0.26
Nodes (11): decodeHex(), DEFAULT_SCRYPT_PARAMS, deriveKey(), encodeParams(), hashPassword(), parseStoredHash(), positiveInteger(), ScryptParams (+3 more)

### Community 79 - "DocumentsUploader.tsx"
Cohesion: 0.29
Nodes (12): DocumentRow(), DocumentRowProps, DocumentsUploader(), DocumentsUploaderProps, formatBytes(), isPdf(), ImagePreviewModal(), StagedDropzone() (+4 more)

### Community 80 - "documentsUploader.test.tsx"
Cohesion: 0.21
Nodes (7): nextKey, stageAndProcess(), useArtworkDocuments(), AddFilesResult, Harness(), renderHarness(), withHook()

### Community 81 - "API Backend Overview"
Cohesion: 0.20
Nodes (11): @arcula/api Backend, Bun and Lambda Entry Points, Uniform Error Envelope, Hono App (app.ts), /api/v1 Resource API, responsePolicy.ts, SPA Serving Middleware (spa.ts), SPA HTML Entry (index.html) (+3 more)

### Community 82 - "Mail and Domain Docs"
Cohesion: 0.23
Nodes (8): email/provider.ts, Invitation Loop, invitations.ts, Ownership Transfer, The Four Arcula Mails, Hosted Wordmark arcula-name-logo.png, collections.userId as the One Owner Fact, normalizeEmail

### Community 83 - "DB Migration and Provision Scripts"
Cohesion: 0.18
Nodes (5): repoRoot, inCi, repoRoot, dead, host

### Community 84 - "Collection Password Control"
Cohesion: 0.26
Nodes (11): PasswordControlInput, PasswordControlMode, passwordControlMode(), PasswordFormInput, PasswordWrite, resolvePasswordWrite(), ADR-0005, GeneralTabProps (+3 more)

### Community 85 - "Access Web Service"
Cohesion: 0.10
Nodes (15): accessService, leftSchema, removedSchema, access, Call, collectionAccessSchema, collectionMemberSchema, collectionRoleSchema (+7 more)

### Community 86 - "relativeTime.ts"
Cohesion: 0.29
Nodes (7): relative, relativeTime(), RelativeTimePart, relativeTimePart(), UNITS, NOW, Timestamp

### Community 87 - "DB Reset and S3 Scripts"
Cohesion: 0.22
Nodes (8): postgres@3.4.9, sql, repoRoot, s3, signedIn, signedUp, DROP_APP_SCHEMAS_SQL, postgres

### Community 88 - "API Dev Dependencies"
Cohesion: 0.18
Nodes (11): devDependencies, fontkit@^2.0.4, @types/bun@^1.4.2, @types/fontkit@2.0.9, @types/nodemailer@^8.0.2, vitest@5.0.2, vitest, fontkit (+3 more)

### Community 89 - "Migrations and Object Keys"
Cohesion: 0.22
Nodes (7): media/keys.ts Object-Key Algebra, 0003_shared_collections Migration, 0004_media_namespace_not_null Migration, 0006_enable_rls Migration, Data Backfill Hand Edit, collections.mediaNamespaceId, Structural Contract Tests

### Community 90 - "Access Card and Invitation Time"
Cohesion: 0.28
Nodes (9): AccessCard(), AccessCardProps, INVITATION_RESEND_COOLDOWN_MS, invitationLapsed(), invitationResendWaitMs(), timestampMillis(), CollectionMember, invitationCreateSchema (+1 more)

### Community 91 - "managePage.test.tsx"
Cohesion: 0.22
Nodes (7): authState, collection, freeMe, getUserCollections, LocationProbe(), renderPage(), sharedCollection

### Community 92 - "Collection Gates Decisions"
Cohesion: 0.24
Nodes (9): Per-work isPublic flag (removed), Public / Private collection visibility, The collection gates; a work is published or draft, A password is a second condition on a public collection, Protected collection, A third visibility state public/private/protected (rejected), Collection PDF, Document metadata and the downloaded filename (+1 more)

### Community 93 - "artworkAddPage.test.tsx"
Cohesion: 0.25
Nodes (4): commits, createArtwork, LocationProbe(), renderPage()

### Community 94 - "ESLint Config"
Cohesion: 0.18
Nodes (8): eslint@^10.11.0, eslint-config-prettier@^10.1.8, eslint-plugin-react-refresh@^0.5.7, globals@^17.12.0, eslint, eslint-config-prettier, eslint-plugin-react-refresh, globals

### Community 95 - "OIDC Provisioning"
Cohesion: 0.18
Nodes (8): account, BRANCHES, [owner, name], permissions, provisioned, readBack, remote, repo

### Community 96 - "Access Roles Glossary"
Cohesion: 0.31
Nodes (10): Sharing Is Membership, Account, Collaborator, Free Tier, Owner, Private, Public, Shared (vs Public) (+2 more)

### Community 97 - "Membership Verdicts"
Cohesion: 0.23
Nodes (10): Access Ending: Removal and Leaving, Pure Access Verdicts (access.ts), artworkRead.ts, Membership Loading (authorize.ts), 403 password-required Challenge, The Collection Gate, Sharing by Membership, Access grant (+2 more)

### Community 98 - "Basicx Skin Tests"
Cohesion: 0.29
Nodes (7): artwork(), collection, matches(), mediaQueryAnswer(), photo(), render(), renderSkin()

### Community 99 - "Invitation Service Tests"
Cohesion: 0.20
Nodes (9): invitationService, answer(), Call, collection, declined, inboxEntry, offer, preview (+1 more)

### Community 100 - "Visitor Visibility Rules"
Cohesion: 0.20
Nodes (9): Artwork status: published or draft, The grant admits exactly what a visitor sees, isExportable: published and live only, Document ordering by Intl.Collator on artist, title, id, The no-photo 2x3 grid, Page count formula, US Letter page geometry in points, PDF page plan (buildCollectionPdfPlan) (+1 more)

### Community 101 - "Issue Tracker Process"
Cohesion: 0.24
Nodes (10): Frontier Query, GitHub Issues via gh CLI, Native Issue Dependencies (Blocking), PRs as a Request Surface: No, Shared Issue/PR Number Space, Sub-Issues and Part-of Lines, Wayfinding Map and Child Tickets, Five Canonical Triage Roles (+2 more)

### Community 102 - "0005_collection_passwords Migration"
Cohesion: 0.25
Nodes (8): collectionGrants.ts, arcula_grant_{collectionId} Cookie, isPasswordProtected, role / ownerName on GET /collections, 0005_collection_passwords Migration, collection_access_grants Table, collections.passwordHash, Wire Types (types.ts)

### Community 103 - "PWA Manifest"
Cohesion: 0.22
Nodes (8): background_color, display, icons, name, scope, short_name, start_url, theme_color

### Community 104 - "utils/invitation.ts"
Cohesion: 0.39
Nodes (5): requireInvitedEmail(), InvitationAudience, invitationAudience(), InvitationViewer, normalizeEmail()

### Community 105 - "Photo Uploader"
Cohesion: 0.31
Nodes (9): labelFor(), PhotoUploaderProps, previewPhotoAt(), previewPhotoFor(), SortableTile(), SortableTileProps, PhotoEntry, UseArtworkPhotos (+1 more)

### Community 106 - "vite.config.ts"
Cohesion: 0.25
Nodes (5): vite@^8.3.1, @vitejs/plugin-react@^6.1.1, envDir, vite, @vitejs/plugin-react

### Community 107 - "PDF Access Outcomes"
Cohesion: 0.33
Nodes (6): AccessLost, accessRefusalOutcome(), CollectionPdfAccessError, collectionReadOutcome(), recheckCollectionAccess(), collection

### Community 108 - "Media Service Client"
Cohesion: 0.42
Nodes (8): apiRequest(), base(), discard(), process(), stage(), StagedOriginal, StagedVariants, ImageVariant

### Community 109 - "Branch Strategy Decisions"
Cohesion: 0.22
Nodes (7): Merging is deploying, Preview environment per pull request (rejected), Two long-lived branches, two permanent environments, Arcula and ArculaDev stacks, CDKToolkit bootstrap, One AWS account and one CDK bootstrap for both environments, A second AWS account (rejected)

### Community 110 - "CDK Build Config"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, outDir, rootDir, sourceMap, extends, include, ./tsconfig.json

### Community 111 - "Branch and Docs Guide"
Cohesion: 0.36
Nodes (8): Arcula Agent Guide (AGENTS.md), dev Branch (default, integration), Domain Docs: One GLOSSARY.md and docs/adr/ (single-context), Hotfix Branches From main and Back-Merges Into dev, main Branch (production only), Two Branches, Two Environments, Arcula Glossary, Collector

### Community 112 - "API Package Scripts"
Cohesion: 0.25
Nodes (8): scripts, db:migrate, db:reset, db:seed, db:studio, dev, start, test

### Community 113 - "Sharing ADR Cross-References"
Cohesion: 0.25
Nodes (7): Documents are never read by a visitor, Access is membership, collection_collaborators table, Collections are shared by membership, Conflict (409) error envelope for sharing state conflicts, The owner administers access, A read-only viewer role (rejected)

### Community 114 - "Monorepo Layout Guide"
Cohesion: 0.29
Nodes (7): Bun Workspaces Monorepo, clientAddress.ts (x-arcula-client-ip), packages/db (Drizzle schema and generated migrations), packages/shared (the client⇄server contract), The Unlock Throttle, unlockThrottle.ts (UNLOCK_WINDOW_MS, unlockWindowStart), Drizzle ORM Skill (.agents/skills/drizzle-orm/SKILL.md)

### Community 115 - "Agent Rules and gh Account"
Cohesion: 0.29
Nodes (7): External Docs — Fetch on Demand (Mantine, Hono llms.txt), Rule: Confirm the Active gh Account Is mixcas, graphify Scope Rule, Issue Tracker (GitHub Issues, mixcas/arcula), Triage Labels (five default roles), Hono Skill (.agents/skills/hono/SKILL.md), llmstxt Installed-Documentation Convention

### Community 117 - "Arcula Icon Set"
Cohesion: 0.57
Nodes (7): Apple Touch Icon (black organic splash mark on white), Favicon 32x32 (same splash mark, downscaled), PWA Icon 192x192 (splash mark, standard mask), PWA Maskable Icon 512x512 (inverted: cream mark on charcoal full bleed), Arcula Splash Mark (organic ink-blot glyph), Icon Polarity Inversion (dark-on-light vs light-on-dark), PWA Icon Set (standard + maskable)

### Community 118 - "Web Tests TypeScript Config"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, types, extends, include, ../tsconfig.json

### Community 119 - "Migrations and Rollback Decisions"
Cohesion: 0.29
Nodes (3): The tier cap counts owned collections, Transfer is immediate and leaves the previous owner as collaborator, collections.userId is the one owner fact

### Community 120 - "PDF Viewer and Lock Plan"
Cohesion: 0.29
Nodes (6): publicCollectionState locked branch, /collection/:collectionId/pdf viewer route, Manage page PDF entry-point button, ManageLayout shell with a header slot, pdfBarView and pdfFileSummary, publicFailure decides locked/private/error

### Community 122 - "Lock Screen Refusals"
Cohesion: 0.33
Nodes (4): Collection lock screen (app chrome, not a skin), 403 password-required refusal with collectionName, CollectionLockScreen reused by the PDF viewer, Image unavailable placeholder page

### Community 123 - "PDF Template Designs"
Cohesion: 0.67
Nodes (6): Collection PDF Export, Arcula PDF Template, Artwork Page Template, Two-Column Metadata Layout, Artwork Metadata Field Set, Artworks Grid Template

### Community 124 - "Web Package Scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, preview, test

### Community 125 - "PDF Font Choices"
Cohesion: 0.40
Nodes (4): Darker Grotesque static font faces, fontkit glyph-only subset (rejected), Noto Sans SC fallback face and font-fallback endpoint, GET /api/v1/pdf/font-fallback

### Community 126 - "Collection Tier Limits"
Cohesion: 0.60
Nodes (3): COLLECTION_LIMITS, collectionLimitForTier(), CollectionTier

### Community 127 - "Port Check Script"
Cohesion: 0.40
Nodes (3): port, s, t

### Community 128 - "@arcula/shared Client Contract"
Cohesion: 0.20
Nodes (9): Invitation Resend Rotation, media/pipeline.ts (Sharp), media/populations.ts, media/variants.ts Variant Geometry, @arcula/shared Client Contract, artworkPhotos.ts Order Invariant, caps.ts File Caps, invitationTime.ts (+1 more)

### Community 129 - "Arcula Brand Marks"
Cohesion: 0.67
Nodes (4): Arcula Wordmark, Arcula Brand Identity, Arcula Favicon (Ink Splat Mark), Arcula App Icon (512px)

### Community 132 - "CDK Package Scripts"
Cohesion: 0.50
Nodes (4): scripts, build, synth, test

### Community 133 - "Password Migration"
Cohesion: 0.67
Nodes (3): "collection_access_grants", collection_access_grants_collection_id_idx, "collection_unlock_attempts"

### Community 137 - "Deploy Overview"
Cohesion: 0.67
Nodes (3): scripts/deploy.sh Shared Deploy Sequence, One Lambda Serving API and SPA, Dev and Production Environments

## Ambiguous Edges - Review These
- `ApiFunction (nodejs24.x arm64 Lambda serving Hono + SPA)` → `COLLECTION_LIMITS Shared by API and Client`  [AMBIGUOUS]
  infra/cdk/README.md · relation: conceptually_related_to
- `Member-Only Collection Search (?q=) Over Ten Fields` → `serialize.ts Wire Shape`  [AMBIGUOUS]
  project-plan.md · relation: conceptually_related_to
- `email/provider.ts` → `Email Opt-Out Deferred Until Complaints`  [AMBIGUOUS]
  docs/mail.md · relation: conceptually_related_to
- `The Collection Gate` → `Flag ADR Conflicts Explicitly`  [AMBIGUOUS]
  docs/agents/domain.md · relation: conceptually_related_to

## Knowledge Gaps
- **140 isolated node(s):** `ADR-0005`, `ADR-0005`, `ADR-0004`, `ADR-0004`, `ADR-0005` (+135 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 908 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Access grant` connect `Membership Verdicts` to `0005_collection_passwords Migration`, `Access Grants and Unlock Throttle`, `API Backend Overview`, `Lock Screen Refusals`, `@arcula/db Schema Package`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **What connects `ADR-0005`, `ADR-0005`, `ADR-0004` to the rest of the system?**
  _140 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Why does `POST /collections/:id/unlock` connect `Access Grants and Unlock Throttle` to `Membership Verdicts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Should `Artwork` be split into smaller, more focused modules?**
  _Cohesion score 0.05411764705882353 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `ApiFunction (nodejs24.x arm64 Lambda serving Hono + SPA)` and `COLLECTION_LIMITS Shared by API and Client`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Member-Only Collection Search (?q=) Over Ten Fields` and `serialize.ts Wire Shape`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._