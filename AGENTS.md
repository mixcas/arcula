# Custodia Agent Guide

This is a React + TypeScript + Vite project using Firebase for authentication and Firestore for data storage.

## Key Commands

- `npm run dev` - Start development server (port 3000)
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Project Structure

- **Frontend**: React 19 with TypeScript
- **UI Framework**: Mantine UI Components (@mantine/core)
- **Routing**: react-router-dom v7
- **State Management**: React Hooks + Context API
- **Authentication**: Firebase Authentication 
- **Database**: Firestore

## Important Details

- **Entry Point**: `src/App.tsx` - Main routing configuration
- **Firebase Setup**: Configured in `src/services/firebase.ts`
- **Authentication Context**: `src/context/AuthContext.ts`
- **Management Interface**: All `/manage` routes use `src/components/manage/layout/ManageLayout.tsx` for consistent header with user menu and logout

## Key Files

- `src/App.tsx` - Routing configuration (update this to add new routes)
- `src/components/manage/layout/ManageLayout.tsx` - Consistent header layout for management interface
- `src/components/manage/ManagePage.tsx` - Main dashboard showing collections
- `src/components/manage/collection/NewCollectionPage.tsx` - New collection creation form

## Firebase Integration

All Firebase services are imported from `src/services/firebase.ts`:
- `db` for Firestore database 
- `auth` for Authentication
- Environment variables must be configured in `.env` file

## Testing and Development

- Development server runs on port 3000
- Source code in `src/` directory
- Build output in `dist/` directory (auto-cleaned)
- No additional test setup required - uses Vite + React testing library

## Architecture Notes

- Management routes (`/manage/*`) are wrapped with consistent layout
- Layout includes user menu with avatar and logout functionality
- Collection creation uses Firestore `addDoc()` to create new documents in "collections" collection
- Redirects after creation use URLized name + ID format: `/manage/collection/{urlized-name}-{collection-id}`
- All management pages are protected by ProtectedRoute component

## Development Environment

- Uses Vite for fast development server
- TypeScript type checking included
- React 19 with modern hooks and features