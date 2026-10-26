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
import CollectionPage from "./components/manage/CollectionPage";
import ArtworkAddPage from "./components/manage/ArtworkAddPage";
import ArtworkEditPage from "./components/manage/ArtworkEditPage";
import CollectionSettingsPage from "./components/manage/CollectionSettingsPage";
import CsvImportPage from "./components/manage/import/CsvImportPage";
import NewCollectionPage from "./components/manage/collection/NewCollectionPage";
import DeletedArtworksPage from "./components/manage/collection/DeletedArtworksPage";
import ProfilePage from "./components/manage/ProfilePage";
import ManageLayout from "./components/manage/layout/ManageLayout";
import PublicCollectionPage from "./components/collection/PublicCollectionPage";
import PublicArtworkPage from "./components/collection/PublicArtworkPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./auth/AuthProvider";

// The PDF renderer is a large separate chunk: only this route may import it,
// so no other page pays for React-PDF in the main bundle.
const CollectionPdfPage = React.lazy(
  () => import("./components/pdf/CollectionPdfPage"),
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
          path="/manage/collection/new"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <NewCollectionPage />
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
          path="/manage/collection/:collectionId"
          element={
            <ProtectedRoute>
              {/* xl, not the default container: the artwork table needs the
                  width for its title, artist and action columns side by side. */}
              <ManageLayout containerProps={{ size: "xl" }}>
                <CollectionPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/collection/:collectionId/deleted"
          element={
            <ProtectedRoute>
              {/* The Deleted view is its own deep-linkable page, at the
                  collection's table width. */}
              <ManageLayout containerProps={{ size: "xl" }}>
                <DeletedArtworksPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/collection/:collectionId/artwork/add"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <ArtworkAddPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/collection/:collectionId/artwork/:artworkId"
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
          path="/manage/collection/:collectionId/settings/:tab?"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <CollectionSettingsPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/collection/:collectionId/import/csv"
          element={
            <ProtectedRoute>
              <ManageLayout containerProps={{ fluid: true }}>
                <CsvImportPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />
        {/* Public collection view. Both routes render the collection's skin;
            see src/skins/registry.ts. */}
        <Route
          path="/collection/:collectionId"
          element={<PublicCollectionPage />}
        />
        <Route
          path="/collection/:collectionId/artwork/:artworkId"
          element={<PublicArtworkPage />}
        />
        {/* The Collection PDF viewer. Public chrome: the route itself decides
            access through the ordinary reads, never a ProtectedRoute. */}
        <Route
          path="/collection/:collectionId/pdf"
          element={
            <React.Suspense
              fallback={
                <Center py="xl">
                  <Loader />
                </Center>
              }
            >
              <CollectionPdfPage />
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
