import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Center, Loader } from "@mantine/core";
import LandingPage from "./components/landing/LandingPage";
import LoginPage from "./components/auth/LoginPage";
import ConsentPage from "./components/auth/ConsentPage";
import SignUpPage from "./components/auth/SignUpPage";
import ResetRequestPage from "./components/auth/ResetRequestPage";
import ResetPasswordPage from "./components/auth/ResetPasswordPage";
import InvitationPage from "./components/invitation/InvitationPage";
import ManagePage from "./components/manage/ManagePage";
import CataloguePage from "./components/manage/CataloguePage";
import ArtworkAddPage from "./components/manage/ArtworkAddPage";
import ArtworkEditPage from "./components/manage/ArtworkEditPage";
import CatalogueSettingsPage from "./components/manage/CatalogueSettingsPage";
import CsvImportPage from "./components/manage/import/CsvImportPage";
import NewCataloguePage from "./components/manage/catalogue/NewCataloguePage";
import DeletedArtworksPage from "./components/manage/catalogue/DeletedArtworksPage";
import SelectionsPage from "./components/manage/catalogue/SelectionsPage";
import SelectionPage from "./components/manage/catalogue/SelectionPage";
import ProfilePage from "./components/manage/ProfilePage";
import ManageLayout from "./components/manage/layout/ManageLayout";
import PublicLayout from "./components/layout/PublicLayout";
import PublicCataloguePage from "./components/catalogue/PublicCataloguePage";
import PublicArtworkPage from "./components/catalogue/PublicArtworkPage";
import PublicSelectionPage from "./components/catalogue/PublicSelectionPage";
import PublicSelectionArtworkPage from "./components/catalogue/PublicSelectionArtworkPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { LANDING_PALETTE } from "./components/landing/palette";
import { AuthProvider } from "./auth/AuthProvider";

// The PDF renderer is a large separate chunk: only this route may import it,
// so no other page pays for React-PDF in the main bundle.
const CataloguePdfPage = React.lazy(
  () => import("./components/pdf/CataloguePdfPage"),
);

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Routes>
        {/* The home route is the one full-bleed public page: its sections own
            their gutters and reach the window's edge, so the frame contributes
            neither a max width nor padding. It is still a PublicLayout child,
            which is what keeps the header from being the page's to remember.
            The header wears the landing page's paper, not the app's grey: `/`
            is the product's public face and its sections are composed on that
            surface. The auth pages keep the grey their forms were designed
            against. */}
        <Route
          element={
            <PublicLayout
              containerProps={{ fluid: true, px: 0 }}
              padding={0}
              headerBackground={LANDING_PALETTE.paper}
            />
          }
        >
          <Route path="/" element={<LandingPage />} />
        </Route>

        {/* The auth pages keep the narrow column: a form wants a measure, and
            the landing page's full width would strand one. */}
        <Route element={<PublicLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          {/* The OAuth consent screen. Not wrapped in ProtectedRoute: the page
              itself sends a signed-out visitor to /login with the signed query,
              which is where the provider put it in the first place. */}
          <Route path="/consent" element={<ConsentPage />} />
          {/* Password reset is two routes: the bare path asks for the address
              (the door on sign-in), and the token path is the form the mail's
              link lands on. An absent/expired token is the server's 400, not a
              route miss. */}
          <Route path="/reset-password" element={<ResetRequestPage />} />
          <Route
            path="/reset-password/:token"
            element={<ResetPasswordPage />}
          />
          {/* The mail's invitation link. The token is the path segment the
              preview, accept and decline calls all carry. */}
          <Route path="/invite/:token" element={<InvitationPage />} />
        </Route>

        {/* Protected Routes */}
        <Route
          path="/manage"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <ManagePage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/catalogue/new"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <NewCataloguePage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/profile"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <ProfilePage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/catalogue/:catalogueId"
          element={
            <ProtectedRoute>
              {/* xl, not the default container: the artwork table needs the
                  width for its title, artist and action columns side by side. */}
              <ManageLayout containerProps={{ size: "xl" }}>
                <CataloguePage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/catalogue/:catalogueId/deleted"
          element={
            <ProtectedRoute>
              {/* The Deleted view is its own deep-linkable page, at the
                  catalogue's table width. */}
              <ManageLayout containerProps={{ size: "xl" }}>
                <DeletedArtworksPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/catalogue/:catalogueId/artwork/add"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <ArtworkAddPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        {/* A Catalogue's Selections: the list and one Selection's manage page.
            Both need the xl width the ordered works list will use. */}
        <Route
          path="/manage/catalogue/:catalogueId/selections"
          element={
            <ProtectedRoute>
              <ManageLayout containerProps={{ size: "xl" }}>
                <SelectionsPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/catalogue/:catalogueId/selection/:selectionId"
          element={
            <ProtectedRoute>
              <ManageLayout containerProps={{ size: "xl" }}>
                <SelectionPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/catalogue/:catalogueId/artwork/:artworkId"
          element={
            <ProtectedRoute>
              <ManageLayout containerProps={{ size: "xl" }}>
                <ArtworkEditPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        {/* The optional final segment names the tab — general, public,
            access, data — and a bare address is what /settings/general
            looks like: the page's canonicalisation effect lands old links
            there rather than a redirect route. */}
        <Route
          path="/manage/catalogue/:catalogueId/settings/:tab?"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <CatalogueSettingsPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/catalogue/:catalogueId/import/csv"
          element={
            <ProtectedRoute>
              <ManageLayout containerProps={{ fluid: true }}>
                <CsvImportPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        {/* Public catalogue view. Both routes render the catalogue's skin;
            see src/skins/registry.ts. */}
        <Route
          path="/catalogue/:catalogueId"
          element={<PublicCataloguePage />}
        />
        <Route
          path="/catalogue/:catalogueId/artwork/:artworkId"
          element={<PublicArtworkPage />}
        />
        {/* A Selection's own address: public chrome, no ProtectedRoute. The
            page decides access through the ordinary read, so a visitor lands on
            the lock screen or the not-found state rather than /login. */}
        <Route
          path="/selection/:selectionId"
          element={<PublicSelectionPage />}
        />
        <Route
          path="/selection/:selectionId/artwork/:artworkId"
          element={<PublicSelectionArtworkPage />}
        />
        {/* The Catalogue PDF viewer. Public chrome: the route itself decides
            access through the ordinary reads, never a ProtectedRoute. */}
        <Route
          path="/catalogue/:catalogueId/pdf"
          element={
            <React.Suspense
              fallback={
                <Center py="xl">
                  <Loader />
                </Center>
              }
            >
              <CataloguePdfPage />
            </React.Suspense>
          }
        />

        {/* Redirect all other routes to homepage */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
