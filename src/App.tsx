import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ProductPage from "./components/ProductPage";
import LoginPage from "./components/auth/LoginPage";
import ManagePage from "./components/manage/ManagePage";
import CollectionPage from "./components/manage/CollectionPage";
import ArtworkAddPage from "./components/manage/ArtworkAddPage";
import ArtworkEditPage from "./components/manage/ArtworkEditPage";
import CollectionSettingsPage from "./components/manage/CollectionSettingsPage";
import CsvImportPage from "./components/manage/import/CsvImportPage";
import MigrationsPage from "./components/manage/MigrationsPage";
import NewCollectionPage from "./components/manage/collection/NewCollectionPage";
import ManageLayout from "./components/manage/layout/ManageLayout";
import PublicCollectionPage from "./components/collection/PublicCollectionPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<ProductPage />} />
        <Route path="/login" element={<LoginPage />} />

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
              <ManageLayout>
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
        <Route
          path="/manage/migrations"
          element={
            <ProtectedRoute>
              <ManageLayout>
                <MigrationsPage />
              </ManageLayout>
            </ProtectedRoute>
          }
        />

        {/* Public Collection View */}
        <Route
          path="/collection/:collectionId"
          element={<PublicCollectionPage />}
        />

        {/* Redirect all other routes to homepage */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
};

export default App;
