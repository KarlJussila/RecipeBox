const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script for Recipe Manager Electron app
 * 
 * This script safely exposes Electron APIs to the renderer process
 * while maintaining security through context isolation.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Environment info
  isElectron: true,
  
  // Database operations
  databaseOperation: (operation, ...args) => ipcRenderer.invoke('database-operation', operation, ...args),
  
  // File operations
  uploadFile: (fileInfo) => ipcRenderer.invoke('upload-file', fileInfo),
  downloadFile: (filePath, fileName) => ipcRenderer.invoke('download-file', filePath, fileName),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath), // ✅ NEW: open file in default app
  
  // Export/Import operations
  exportFiles: () => ipcRenderer.invoke('export-files'),
  importFiles: (files) => ipcRenderer.invoke('import-files', files),
  
  // App operations
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getDatabasePath: () => ipcRenderer.invoke('get-database-path'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  
  // Menu actions
  onAddRecipe: (callback) => ipcRenderer.on('add-recipe', callback),
  onExportDatabase: (callback) => ipcRenderer.on('export-database', callback),
  onImportDatabase: (callback) => ipcRenderer.on('import-database', callback),
  onShowAbout: (callback) => ipcRenderer.on('show-about', callback),
  
  // Database ready event
  onDatabaseReady: (callback) => ipcRenderer.on('database-ready', callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // *** NEW: Added for macOS drag and drop fix ***
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath)
});

// Also publish a minimal global flag for convenience checks
try {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  window.__IS_ELECTRON__ = true;
} catch {}
