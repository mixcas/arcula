import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ProductPage from "./components/ProductPage";
import LoginPage from "./components/auth/LoginPage";
import SignUpPage from "./components/auth/SignUpPage";
import ResetPasswordPage from "./components/auth/ResetPasswordPage";
import ManagePage from "./components/manage/ManagePage";
import CollectionPage from "./components/manage/CollectionPage";
import ArtworkAddPage from "./components/manage/ArtworkAddPage";
import ArtworkEditPage from "./components/manage/ArtworkEditPage";
import CollectionSettingsPage from "./components/manage/CollectionSettingsPage";
import CsvImportPage from "./components/manage/import/CsvImportPage";
import NewCollectionPage from "./components/manage/collection/NewCollectionPage";
import ProfilePage from "./components/manage/ProfilePage";
import ManageLayout from "./components/manage/layout/ManageLayout";
import PublicCollectionPage from "./components/collection/PublicCollectionPage";
import PublicArtworkPage from "./components/collection/PublicArtworkPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./auth/AuthProvider";

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<ProductPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        {/* The token in the path is what the reset mail's link carries;
            an absent/expired token is the server's 400, not a route miss. */}
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

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
        <Route
          path="/manage/collection/:collectionId/settings"
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

        {/* Redirect all other routes to homepage */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
