import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Center, Loader } from "@mantine/core";
import ProductPage from "./components/ProductPage";
import LoginPage from "./components/auth/LoginPage";
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
import ProfilePage from "./components/manage/ProfilePage";
import ManageLayout from "./components/manage/layout/ManageLayout";
import PublicCataloguePage from "./components/catalogue/PublicCataloguePage";
import PublicArtworkPage from "./components/catalogue/PublicArtworkPage";
import LegacyCatalogueRedirect from "./components/LegacyCatalogueRedirect";
import ProtectedRoute from "./components/ProtectedRoute";
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
        {/* Public Routes */}
        <Route path="/" element={<ProductPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        {/* Password reset is two routes: the bare path asks for the address
            (the door on sign-in), and the token path is the form the mail's
            link lands on. An absent/expired token is the server's 400, not a
            route miss. */}
        <Route path="/reset-password" element={<ResetRequestPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        {/* The mail's invitation link. The token is the path segment the
            preview, accept and decline calls all carry. */}
        <Route path="/invite/:token" element={<InvitationPage />} />

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

        {/* The addresses the unit had before the rename: both families move to
            the catalogue spelling with the rest of the path, the query and the
            hash kept. Removed in the contract step (#248), once no old link
            can still be in the wild. */}
        <Route
          path="/collection/*"
          element={
            <LegacyCatalogueRedirect from="/collection" to="/catalogue" />
          }
        />
        <Route
          path="/manage/collection/*"
          element={
            <LegacyCatalogueRedirect
              from="/manage/collection"
              to="/manage/catalogue"
            />
          }
        />

        {/* Redirect all other routes to homepage */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
