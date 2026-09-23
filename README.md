# Custodia

Custodia is a web application for managing art collections. It provides users with the ability to create, organize, and share their art collections.

## Features

- User authentication and authorization
- Collection management (create, view, edit)
- Artwork management within collections
- Public collection sharing
- Responsive design for all devices

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **UI Framework**: Mantine UI Components
- **Routing**: React Router v6
- **State Management**: React Hooks and Context API
- **Authentication**: Firebase Authentication
- **Database**: Firestore
- **Build Tool**: Vite

## Project Structure

```
src/
├── components/
│   ├── manage/                 # Management interface components
│   │   ├── ManagePage.tsx      # Main dashboard page
│   │   ├── CollectionPage.tsx  # Individual collection view
│   │   ├── ArtworkAddPage.tsx  # Add artwork to collection
│   │   ├── ArtworkEditPage.tsx # Edit artwork details
│   │   ├── CollectionSettingsPage.tsx # Collection settings
│   │   └── layout/            # Layout components
│   │       └── ManageLayout.tsx  # Consistent header layout for manage routes
│   ├── auth/                   # Authentication components
│   │   └── LoginPage.tsx       # Login page
│   └── ProductPage.tsx         # Public landing page
├── context/                    # React Context providers
│   └── AuthContext.ts          # Authentication context
├── services/                   # Service files
│   └── firebase.ts             # Firebase configuration and initialization
└── App.tsx                     # Main application routing
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd custodia
```

2. Install dependencies:
```bash
bun install
```

3. Create a `.env` file in the root directory with your Firebase configuration:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

4. Start the development server:
```bash
bun run dev
```

## Firebase Setup

This application uses Firebase for authentication and data storage. You'll need to:

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication (Email/Password)
3. Enable Firestore Database
4. Configure the required environment variables in your `.env` file

## Available Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run preview` - Preview production build

## Folder Structure Explanation

### Manage Interface (`/manage`)
The `/manage` routes are wrapped with a consistent layout that provides:
- Header with user menu (avatar and email)
- Logout functionality via dropdown menu
- Consistent padding and styling

### Core Pages
- **ManagePage**: Main dashboard showing all collections
- **CollectionPage**: View and manage individual collections  
- **ArtworkAddPage**: Add new artworks to collections
- **ArtworkEditPage**: Edit artwork details
- **CollectionSettingsPage**: Collection settings and privacy controls

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [React](https://reactjs.org/)
- [Mantine UI](https://mantine.dev/)
- [Firebase](https://firebase.google.com/)
- [Vite](https://vitejs.dev/)