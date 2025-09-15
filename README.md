# RecipeBox Electron

A modern desktop recipe management application built with Electron, React, and TypeScript.

## Features

- **Recipe Management**: Add, edit, and delete recipes with photos and source URLs
- **Tag System**: Organize recipes with custom tags and filtering
- **Search**: Find recipes by name, description, or tags
- **Cook Time Filtering**: Filter recipes by maximum cook time
- **Import/Export**: Backup and restore your recipe database
- **Dark Mode**: Toggle between light and dark themes
- **Responsive Design**: Works on different screen sizes with collapsible sidebar

## Development Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd RecipeBoxElectron
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run electron-dev
   ```

## Building for Production

### Windows
```bash
npm run dist:win
```

### macOS
```bash
npm run dist:mac
```

### Linux
```bash
npm run dist:linux
```

## Project Structure

```
RecipeBoxElectron/
├── src/                    # React application source
│   ├── components/         # React components
│   ├── lib/               # Database and utility functions
│   └── App.tsx            # Main application component
├── main.js                # Electron main process
├── preload.js             # Electron preload script
├── build-vite.js          # Custom build script
└── package.json           # Project configuration
```

## Key Technologies

- **Electron**: Desktop app framework
- **React**: UI library
- **TypeScript**: Type safety
- **Tailwind CSS**: Styling
- **Shadcn/ui**: Component library
- **SQL.js**: In-memory SQLite database
- **Vite**: Build tool

## Database

The app uses SQL.js (SQLite in JavaScript) for data storage. The database is automatically created and managed by the application.

## Recent Improvements

- Dynamic sidebar height with smooth transitions
- Improved filter sidebar layout with proper scrolling
- Always-visible cook time filter (grayed out when disabled)
- Custom thin scrollbars for better aesthetics
- Responsive design with collapsible elements
- Enhanced button alignment and icon positioning

## License

MIT
