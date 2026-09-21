# Custodia Art Collection Management - Project Plan

## Overview

Custodia is an art collection management software that will allow users to manage their artwork collections with detailed information tracking, file attachments for certificates and photos, and future support for multiple collections per user.

## Status Update

We have implemented the core frontend structure, including:
- Complete routing system
- All major components (Login, Product Page, Management pages, Public Collection views)
- Firebase service integration (Firestore, Authentication, Storage)
- Type definitions for User, Collection, and Artwork models

## Tech Stack

- **Frontend**: React + TypeScript + Mantine UI + react-router-dom
- **Backend**: Firebase (Firestore for data, Firebase Storage for files)

## Core Data Models

### 1. User

- uid (unique identifier)
- email
- name
- collections (array of collection references)

### 2. Collection

- id (unique identifier)
- name
- user_id (reference to the owner)
- is_public (boolean)
- password_hash (optional, for password protection)
- artworks (array of artwork references)

### 3. Artwork

- id (unique identifier)
- title
- serie
- artist_name
- date_of_creation
- medium
- dimensions
- acquisition_date
- acquisition_price
- place_of_origin
- certificates (array of file references - URLs or metadata)
- notes
- condition
- current_value
- photos (array of file references - URLs or metadata)
- collection_id (reference to the parent collection)

## Key Features

1. **Collection Management**
   - Create, view, edit collections
   - Associate artworks with collections

2. **Artwork Management**
   - Detailed artwork entry forms using Mantine UI components
   - File upload for certificates (images/PDFs) and photos (images only)
   - Data validation for various formats (dates, prices, etc.)

3. **Data Persistence**
   - Firebase Firestore for structured data
   - Firebase Storage for file attachments

4. **Authentication & Security**
   - User authentication system
   - Private collection password protection

5. **Public Access**
   - Public collection viewing with optional password protection
   - Toggle between list and mosaic views

## Folder Structure

```
/src
  /components
    auth/
      LoginPage.tsx
    manage/
      ManagePage.tsx
      CollectionPage.tsx
      ArtworkAddPage.tsx
      ArtworkEditPage.tsx
      CollectionSettingsPage.tsx
    collection/
      PublicCollectionPage.tsx
    ProductPage.tsx
  /services
    firebase.ts (Firebase initialization)
    collectionService.ts
    artworkService.ts
    authService.ts
  /types
    index.ts (Type definitions)
  App.tsx
  index.tsx
  index.css
```

## Routing Structure

### Public Pages

- `/` - Product page. We present the product and link to `/login`. But for now it should be a very simple page. We will worry about this later. The only important thing right now is the login link.
- `/login` - Simple login form

### Management Pages

- `/manage` - Main management page. Nothing much for now but the list of current collections
- `/manage/collection/${URLized collection name}-${collection ID}` - Main management page for a collection. List/Mosaic view of Artworks in Collection, with Edit button. Button to add Artworks. Link to Collection Settings
- `/manage/collection/${URLized collection name}-${collection ID}/artwork/add` - Form page to create a new artwork
- `/manage/collection/${URLized collection name}-${collection ID}/artwork/${URLized art work title}-${artwork ID}` - Edit page to edit artwork
- `/manage/collection/${URLized collection name}-${collection ID}/settings` - Page to manage collection settings:
  - Edit collection title
  - Edit collection privacy settings (public/private)
    - Private allow for a password protected collection: When this is enabled the public page for a collection would be password protected

### Public Collection Viewing

- `/collection/${URLized collection name}-${collection ID}` - Public page for viewing a collection. Name on the top. Toggle to switch between List / Mosaic view.
  - List view: Expanded list of all artworks
    - Title and Artist
    - Photos in a carousel
    - Extra info
  - Mosaic: Only First Photo, Title and Artist
  - If the collection is private display a Private message. If password protected prompt for password.

## Component Breakdown

### Auth Components:

- `LoginPage` - Simple login form for user authentication

### Management Components:

- `ManagePage` - Main dashboard showing all collections
- `CollectionPage` - Detail view of a single collection with artworks
- `ArtworkAddPage` - Form to add new artwork items
- `ArtworkEditPage` - Form to edit existing artwork items
- `CollectionSettingsPage` - Settings for collection privacy and protection

### Public Components:

- `PublicCollectionPage` - Public-facing view of a collection with list/mosaic toggle

### Utility Components:

- `ProductPage` - Landing page that links to login

## Firebase Implementation Plan

1. **Firebase Setup**:
   - Initialize Firebase in the React app
   - Set up Firestore collections: users, collections, artworks
   - Implement file storage for certificates and photos
   - Configure security rules

2. **Authentication System**:
   - Implement Firebase Authentication
   - Create user sessions
   - Handle login/logout flows

3. **Data Services**:
   - Create collectionService.ts for collection operations
   - Create artworkService.ts for artwork operations
   - Create authService.ts for authentication operations

4. **Security Considerations**:
   - Configure Firestore security rules to protect data
   - Implement password protection for collections
   - Secure file uploads and access

## Data Flow & Architecture

1. **User Authentication**:
   - User logs in via Firebase Auth
   - Session maintained through React context or TanStack Query

2. **Collection Management**:
   - Fetch all collections for a user from Firestore
   - Create new collection with reference to user
   - Update/delete existing collections

3. **Artwork Management**:
   - Fetch artworks for a specific collection
   - Add artwork with all metadata fields (including certificates and photos)
   - Upload files to Firebase Storage
   - Save references to files in Firestore

4. **Public Access**:
   - Check collection privacy settings on load
   - Display password protection prompt if needed
   - Render artworks in either list or mosaic view

## Timeline Considerations

1. **Week 1**: Setup environment, basic components, and Firebase integration
   - React + TypeScript setup
   - Install dependencies (Mantine UI, TanStack Query, Firebase)
   - Implement routes and basic UI components
   - Connect Firebase and set up authentication

2. **Week 2**: Implement collection management features
   - Full collection CRUD operations
   - Collection settings (privacy, password protection)
   - Public collection view with access controls

3. **Week 3**: Implement artwork management + file uploads
   - Complete artwork forms with all required fields
   - File upload components for certificates and photos
   - Data validation for dates, prices, etc.

4. **Week 4**: Add authentication, improve UX, testing
   - Secure routing with authentication checks
   - Improve UI/UX based on user feedback
   - Complete documentation and testing

## Future Enhancements

1. **Multi-collection support**:
   - Expand user-to-collection relationship to many-to-many
   - Allow artworks to be in multiple collections

2. **Advanced search & filtering**:
   - Search by artist, medium, period, etc.
   - Advanced filtering options

3. **Export functionality**:
   - Export collection data as CSV or PDF
   - Generate collection reports

4. **Mobile support**:
   - Responsive design for mobile devices
   - Mobile-optimized workflows

5. **Collaboration features**:
   - Share collections with other users
   - Collaborative editing permissions

## Data Validation Requirements

1. **Date formats**:
   - Acquisition dates should follow consistent format (dd/mm/yyyy)
   - Creation dates should be validated

2. **Price formats**:
   - Currency formatting for acquisition price and current value
   - Support for different currency types

3. **File validation**:
   - Certificate uploads: PDF, JPG, PNG
   - Photo uploads: JPG, PNG, WebP
   - File size limits

4. **Text fields**:
   - Required fields validation
   - Length constraints
   - Proper sanitization

This plan provides a comprehensive roadmap for building your Custodia art collection management application from the ground up, with clear implementation phases and feature requirements.

## Routing Structure

### Public Routes

`/`
This is the product page. We present the product and link to `/login`. But for now it should be a very simple page. We will worry about this later. The only important thing right now is the login link

`/login`
Simple login form

`/collection/${URLized collection name}-${collection ID}`
Public page for viewing a collection. Name on the top. Toggle to switch between List / Mosaic view.
List view: Expanded list of all artworks

- Title and Artist
- Photos in a carousel
- Extra info
  Mosaic: Only First Photo, Title and Artist
  If the collection is private display a Private message. If password protected prompt for password.

### Protected Routes

`/manage`
Main management page. Nothing much for now but the list of current collections

`/manage/collection/${URLized collection name}-${collection ID}`
Main management page for a collection. List/Mosaic view of Artworks in Collection, with Edit button. Button to add Artworks. Link to Collection Settings

`/manage/collection/${URLized collection name}-${collection ID}/artwork/add`
Form page to create a new artwork

`/manage/collection/${URLized collection name}-${collection ID}/artwork/${URLized art work title}-${artwork ID}`
Edit page to edit artwork

`/manage/collection/${URLized collection name}-${collection ID}/settings`
Page to manage collection settings:

- Edit collection title
- Edit collection privacy settings (public/private)
  -- Private allow for a password protected collection: When this is enabled the public page for a collection would be password protected

