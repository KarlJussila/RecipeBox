const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building RecipeBox for Electron with Vite...');

// Clean previous builds
console.log('Cleaning previous builds...');
if (fs.existsSync('dist')) {
  fs.rmSync('dist', { recursive: true });
}

// Clean node_modules cache
if (fs.existsSync('node_modules/.cache')) {
  fs.rmSync('node_modules/.cache', { recursive: true });
}

try {
  // Create dist directory
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }
  
  // Build React app with Vite
  console.log('Building React app with Vite...');
  execSync('npx vite build', { stdio: 'inherit' });
  
  // Create database file
  console.log('Creating database file...');
  if (!fs.existsSync('dist/lib')) {
    fs.mkdirSync('dist/lib', { recursive: true });
  }
  
  // Compile TypeScript database file using tsc
  console.log('Compiling TypeScript database file...');
  try {
    execSync('npx tsc --project tsconfig.electron.json', { stdio: 'inherit' });
    console.log('TypeScript compilation successful');
  } catch (error) {
    console.error('TypeScript compilation failed:', error.message);
    process.exit(1);
  }
  
  // Copy necessary files
  console.log('Copying necessary files...');
  
  // Copy assets
  if (!fs.existsSync('dist/assets')) {
    fs.mkdirSync('dist/assets', { recursive: true });
  }
  if (fs.existsSync('assets/icon.png')) {
    fs.copyFileSync('assets/icon.png', 'dist/assets/icon.png');
  }
  
  // Copy Electron main process files
  fs.copyFileSync('main.js', 'dist/main.js');
  fs.copyFileSync('preload.js', 'dist/preload.js');
  
  // Create a clean package.json without build config for dist
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  delete packageJson.build;
  delete packageJson.scripts;
  delete packageJson.devDependencies;
  
  // Add required fields for electron-builder
  packageJson.author = "RecipeBox Team";
  packageJson.license = "MIT";
  packageJson.repository = {
    "type": "git",
    "url": "https://github.com/recipebox/recipebox-electron"
  };
  
  fs.writeFileSync('dist/package.json', JSON.stringify(packageJson, null, 2));
  
  // Copy uploads directory if it exists
  if (fs.existsSync('uploads')) {
    fs.cpSync('uploads', 'dist/uploads', { recursive: true });
  }
  
  // Install production dependencies in dist folder
  console.log('Installing production dependencies...');
  process.chdir('dist');
  execSync('npm install --production', { stdio: 'inherit' });
  
  // sql.js doesn't need special handling - it's pure JavaScript
  console.log('sql.js is pure JavaScript, no native module issues');
  
  console.log('Build complete!');
  console.log('');
  console.log('To run the Electron app:');
  console.log('  npm run electron');
  console.log('');
  console.log('To create distributable packages:');
  console.log('  npm run dist:win  (Windows)');
  console.log('  npm run dist:mac  (macOS)');
  console.log('  npm run dist:linux (Linux)');
  
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
