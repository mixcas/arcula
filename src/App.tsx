import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ProductPage from "./components/ProductPage";
import LoginPage from "./components/auth/LoginPage";
import ManagePage from "./components/manage/ManagePage";
import CollectionPage from "./components/manage/CollectionPage";
import ArtworkAddPage from "./components/manage/ArtworkAddPage";
import ArtworkEditPage from "./components/manage/ArtworkEditPage";
import CollectionSettingsPage from "./components/manage/CollectionSettingsPage";
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
              <ManagePage />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/manage/collection/:collectionId"
          element={
            <ProtectedRoute>
              <CollectionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/collection/:collectionId/artwork/add"
          element={
            <ProtectedRoute>
              <ArtworkAddPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/collection/:collectionId/artwork/:artworkId"
          element={
            <ProtectedRoute>
              <ArtworkEditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/manage/collection/:collectionId/settings"
          element={
            <ProtectedRoute>
              <CollectionSettingsPage />
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
