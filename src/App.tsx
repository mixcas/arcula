import React from "react";
import { Routes, Route } from "react-router-dom";
import ProductPage from "./components/ProductPage";
import LoginPage from "./components/auth/LoginPage";
import ManagePage from "./components/manage/ManagePage";
import CollectionPage from "./components/manage/CollectionPage";
import ArtworkAddPage from "./components/manage/ArtworkAddPage";
import ArtworkEditPage from "./components/manage/ArtworkEditPage";
import CollectionSettingsPage from "./components/manage/CollectionSettingsPage";
import PublicCollectionPage from "./components/collection/PublicCollectionPage";

const App: React.FC = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<ProductPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Protected Routes */}
      <Route path="/manage" element={<ManagePage />} />
      <Route
        path="/manage/collection/:collectionId"
        element={<CollectionPage />}
      />
      <Route
        path="/manage/collection/:collectionId/artwork/add"
        element={<ArtworkAddPage />}
      />
      <Route
        path="/manage/collection/:collectionId/artwork/:artworkId"
        element={<ArtworkEditPage />}
      />
      <Route
        path="/manage/collection/:collectionId/settings"
        element={<CollectionSettingsPage />}
      />

      {/* Public Collection View */}
      <Route
        path="/collection/:collectionId"
        element={<PublicCollectionPage />}
      />
    </Routes>
  );
};

export default App;
