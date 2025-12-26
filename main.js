const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const isDev = process.env.NODE_ENV === 'development'

let mainWindow
let dbInstance = null

// Database setup for Electron
function setupDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, isDev ? 'recipe-manager-dev.db' : 'recipe-manager.db')
  
  // Ensure the directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true })
  }
  
  // Import and initialize the database
  try {
    // Use the correct path for both development and production
    const isPackaged = app.isPackaged
    const dbModulePath = isPackaged 
      ? path.join(process.resourcesPath, 'app', 'lib', 'electron-db-simple.js')
      : './lib/electron-db-simple.js'
    const { getElectronDb } = require(dbModulePath)
    // Note: getElectronDb is now async, but we'll handle it in the IPC handlers
    // Database module loaded, will initialize on first use
    return dbPath
  } catch (error) {
    console.error('Failed to load database module:', error)
    return null
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: isDev ? path.join(__dirname, 'preload.js') : path.join(process.resourcesPath, 'app', 'preload.js'),
      // Add these settings for better drag and drop support on macOS
      webSecurity: false, // Already present
      allowRunningInsecureContent: true
    },
    icon: isDev ? path.join(__dirname, 'assets/icon.png') : path.join(process.resourcesPath, 'app', 'assets', 'icon.png'),
    show: false,
    titleBarStyle: 'default',
    // Add these properties for better drag and drop support
    acceptFirstMouse: true,
    titleBarOverlay: process.platform === 'darwin' ? {
      color: '#00000000',
      symbolColor: '#ffffff'
    } : false
  })

  // Set up database
  const dbPath = setupDatabase()
  
  // Add this code to handle drag and drop events properly
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    
    if (parsedUrl.origin !== 'file://') {
      event.preventDefault()
    }
  })
  
  // Pass database path to renderer process
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Electron window finished loading, sending database-ready event');
    if (dbPath) {
      mainWindow.webContents.send('database-ready', { dbPath })
    }
    
    // Add this code to enable proper drag and drop on macOS
    mainWindow.webContents.executeJavaScript(`
      document.addEventListener('dragover', (event) => {
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
      }, false)
      
      document.addEventListener('drop', (event) => {
        event.preventDefault()
        event.stopPropagation()
      }, false)
    `)
  })

  // Load the app
  if (isDev) {
    // In development, load static files and open DevTools
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))
    mainWindow.webContents.openDevTools()
  } else {
    // In production, load from the resources directory
    const htmlPath = path.join(process.resourcesPath, 'app', 'renderer', 'index.html')
    console.log('Loading HTML from:', htmlPath)
    console.log('process.resourcesPath:', process.resourcesPath)
    mainWindow.loadFile(htmlPath)
    // Don't open DevTools in production
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    // Close database connection
    if (dbInstance) {
      try {
        dbInstance.close()
        dbInstance = null
      } catch (error) {
        console.error('Error closing database:', error)
      }
    }
    mainWindow = null
  })
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add New Recipe',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('add-recipe')
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Export Database',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('export-database')
            }
          }
        },
        {
          label: 'Import Database',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('import-database')
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          role: 'quit'
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { 
          label: 'Toggle Developer Tools',
          accelerator: 'Ctrl+Shift+I',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.toggleDevTools()
            }
          }
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Recipe Manager',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-about')
            }
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  // Add this for macOS
  if (process.platform === 'darwin') {
    // Set app activation policy for proper file handling
    app.setAboutPanelOptions({
      applicationName: 'Recipe Manager',
      applicationVersion: app.getVersion(),
      copyright: 'Copyright © 2023'
    })
    
    // Handle file opening from Finder
    app.on('open-file', (event, path) => {
      event.preventDefault()
      if (mainWindow) {
        mainWindow.webContents.send('open-file', path)
        mainWindow.show()
      }
    })
  }
  
  createWindow()
  
  // Only create menu in development
  if (isDev) {
    createMenu()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Save database before app quits
  if (dbInstance) {
    try {
      console.log('Saving database before app quit...')
      dbInstance.close()
      dbInstance = null
    } catch (error) {
      console.error('Error saving database on quit:', error)
    }
  }
})

// Handle IPC messages for database operations
ipcMain.handle('get-app-path', () => {
  return app.getPath('userData')
})

ipcMain.handle('get-database-path', () => {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'recipe-manager.db')
})

ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData')
})

// Handle file upload operations
ipcMain.handle('upload-file', async (event, fileInfo) => {
  try {
    const { fileName, fileType, data } = fileInfo
    const fs = require('fs')
    const path = require('path')
    
    // Create uploads directory if it doesn't exist
    const userDataPath = app.getPath('userData')
    const uploadsDir = path.join(userDataPath, 'uploads')
    
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true })
    }
    
    // Generate unique file path
    const uniqueFileName = `${Date.now()}_${fileName}`
    const filePath = path.join(uploadsDir, uniqueFileName)
    
    // Extract base64 data and save to file
    const base64Data = data.replace(/^data:\w+\/\w+;base64,/, '')
    fs.writeFileSync(filePath, base64Data, 'base64')
    
    return {
      filePath: `/uploads/${uniqueFileName}`,
      fileName,
      fileType
    }
  } catch (error) {
    console.error('File upload failed:', error)
    throw error
  }
})

// Handle file download operations
ipcMain.handle('download-file', async (event, filePath, fileName) => {
  try {
    const { dialog, shell } = require('electron')
    const fs = require('fs')
    const path = require('path')
    
    // Convert relative path to absolute path
    let absolutePath
    if (filePath.startsWith('/uploads/')) {
      // Handle uploaded files
      const userDataPath = app.getPath('userData')
      absolutePath = path.join(userDataPath, 'uploads', path.basename(filePath))
    } else {
      // Handle other file paths
      absolutePath = path.resolve(filePath)
    }
    
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      throw new Error('File not found')
    }
    
    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fileName,
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    
    if (!result.canceled && result.filePath) {
      // Copy file to chosen location
      fs.copyFileSync(absolutePath, result.filePath)
      return { success: true, savedPath: result.filePath }
    }
    
    return { success: false, canceled: true }
  } catch (error) {
    console.error('File download failed:', error)
    throw error
  }
})

// Handle export files operation
ipcMain.handle('export-files', async () => {
  try {
    const fs = require('fs')
    const path = require('path')
    
    const userDataPath = app.getPath('userData')
    const uploadsDir = path.join(userDataPath, 'uploads')
    
    if (!fs.existsSync(uploadsDir)) {
      return {}
    }
    
    const files = {}
    const fileList = fs.readdirSync(uploadsDir)
    
    for (const fileName of fileList) {
      const filePath = path.join(uploadsDir, fileName)
      const fileBuffer = fs.readFileSync(filePath)
      const base64Data = fileBuffer.toString('base64')
      files[fileName] = base64Data
    }
    
    return files
  } catch (error) {
    console.error('Export files failed:', error)
    throw error
  }
})

// Handle import files operation
ipcMain.handle('import-files', async (event, files) => {
  try {
    const fs = require('fs')
    const path = require('path')
    
    const userDataPath = app.getPath('userData')
    const uploadsDir = path.join(userDataPath, 'uploads')
    
    // Ensure uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true })
    }
    
    const errors = []
    let importedCount = 0
    
    for (const [fileName, base64Data] of Object.entries(files)) {
      try {
        // Check if file already exists and add timestamp if needed
        let finalFileName = fileName
        let counter = 1
        while (fs.existsSync(path.join(uploadsDir, finalFileName))) {
          const ext = path.extname(fileName)
          const name = path.basename(fileName, ext)
          finalFileName = `${name}_imported_${counter}${ext}`
          counter++
        }
        
        const filePath = path.join(uploadsDir, finalFileName)
        const fileBuffer = Buffer.from(base64Data, 'base64')
        fs.writeFileSync(filePath, fileBuffer)
        importedCount++
      } catch (error) {
        errors.push(`Failed to import file ${fileName}: ${error.message}`)
      }
    }
    
    return {
      importedCount,
      errors: errors.length > 0 ? errors : undefined
    }
  } catch (error) {
    console.error('Import files failed:', error)
    throw error
  }
})

// Handle database export
ipcMain.handle('export-database', async () => {
  try {
    const fs = require('fs')
    const path = require('path')
    const { dialog } = require('electron')
    
    const userDataPath = app.getPath('userData')
    const dbPath = path.join(userDataPath, 'recipe-manager.db')
    
    if (!fs.existsSync(dbPath)) {
      throw new Error('Database file not found')
    }
    
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'recipe-manager-backup.db',
      filters: [
        { name: 'Database Files', extensions: ['db'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    
    if (!result.canceled && result.filePath) {
      fs.copyFileSync(dbPath, result.filePath)
      return { success: true, path: result.filePath }
    }
    
    return { success: false, canceled: true }
  } catch (error) {
    console.error('Database export failed:', error)
    throw error
  }
})

// Handle database import
ipcMain.handle('import-database', async () => {
  try {
    const fs = require('fs')
    const path = require('path')
    const { dialog } = require('electron')
    
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Database Files', extensions: ['db'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    
    if (!result.canceled && result.filePaths.length > 0) {
      const sourcePath = result.filePaths[0]
      const userDataPath = app.getPath('userData')
      const targetPath = path.join(userDataPath, 'recipe-manager.db')
      
      // Close existing database connection
      if (dbInstance) {
        dbInstance.close()
        dbInstance = null
      }
      
      // Copy the database file
      fs.copyFileSync(sourcePath, targetPath)
      
      // Reinitialize database
      setupDatabase()
      
      return { success: true, path: sourcePath }
    }
    
    return { success: false, canceled: true }
  } catch (error) {
    console.error('Database import failed:', error)
    throw error
  }
})

// Handle database operations
ipcMain.handle('database-operation', async (event, operation, ...args) => {
  try {
    if (!dbInstance) {
      const dbPath = setupDatabase()
      if (!dbPath) {
        throw new Error('Failed to initialize database')
      }
      
      // Import the database functions and create global instance
      const isPackaged = app.isPackaged
      const dbModulePath = isPackaged 
        ? path.join(process.resourcesPath, 'app', 'lib', 'electron-db-simple.js')
        : './lib/electron-db-simple.js'
      const { getElectronDb } = require(dbModulePath)
      dbInstance = await getElectronDb()
    }
    
    const db = dbInstance
    
    switch (operation) {
      case 'createRecipe':
        return await db.createRecipe(...args)
      case 'getRecipes':
        return await db.getRecipes()
      case 'getRecipeById':
        return await db.getRecipeById(...args)
      case 'updateRecipe':
        return await db.updateRecipe(...args)
      case 'deleteRecipe':
        const userDataPath = app.getPath('userData')
        return await db.deleteRecipe(...args, userDataPath)
      case 'createTag':
        return await db.createTag(...args)
      case 'getTags':
        return await db.getTags()
      case 'getTagById':
        return await db.getTagById(...args)
      case 'getTagByName':
        return await db.getTagByName(...args)
      case 'updateTag':
        return await db.updateTag(...args)
      case 'deleteTag':
        return await db.deleteTag(...args)
      case 'addTagToRecipe':
        return await db.addTagToRecipe(...args)
      case 'removeTagFromRecipe':
        return await db.removeTagFromRecipe(...args)
      case 'getRecipeTags':
        return await db.getRecipeTags(...args)
      case 'getRecipesWithTag':
        return await db.getRecipesWithTag(...args)
      case 'searchRecipes':
        return await db.searchRecipes(...args)
      case 'seedDatabase':
        // Basic seeding for Electron - tags only
        try {
          // Create predefined tags
          const tags = [
            'Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Vegetarian', 'Vegan',
            'Dairy', 'Dairy Free', 'Meat', 'Fish', 'Chicken', 'Pork', 'Beef',
            'Mexican', 'Indian', 'Pasta', 'Soup', 'Salad', 'Baking'
          ]
          
          for (const tagName of tags) {
            await db.createTag({ name: tagName })
          }
          
          return { success: true }
        } catch (seedError) {
          console.error('Seeding failed:', seedError)
          return { success: false, error: seedError.message }
        }
      case 'clearDatabase':
        const clearUserDataPath = app.getPath('userData')
        return await db.clearDatabase(clearUserDataPath)
      case 'cleanupOrphanedFiles':
        const cleanupUserDataPath = app.getPath('userData')
        return await db.cleanupOrphanedFiles(cleanupUserDataPath)
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  } catch (error) {
    console.error(`Database operation ${operation} failed:`, error)
    throw error
  }
})

// Add these new IPC handlers for drag and drop support

// Handle file preview for drag and drop
ipcMain.handle('preview-file', async (event, filePath) => {
  try {
    const fs = require('fs')
    
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found')
    }
    
    const stats = fs.statSync(filePath)
    const fileBuffer = fs.readFileSync(filePath)
    const base64Data = fileBuffer.toString('base64')
    
    // Get file type from extension
    const path = require('path')
    const ext = path.extname(filePath).toLowerCase()
    let mimeType = 'application/octet-stream'
    
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg'
    else if (ext === '.png') mimeType = 'image/png'
    else if (ext === '.gif') mimeType = 'image/gif'
    else if (ext === '.webp') mimeType = 'image/webp'
    else if (ext === '.pdf') mimeType = 'application/pdf'
    else if (ext === '.txt') mimeType = 'text/plain'
    else if (ext === '.doc') mimeType = 'application/msword'
    else if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    
    return {
      name: path.basename(filePath),
      size: stats.size,
      type: mimeType,
      data: `data:${mimeType};base64,${base64Data}`
    }
  } catch (error) {
    console.error('File preview failed:', error)
    throw error
  }
})

// Handle temporary file creation for drag and drop
ipcMain.handle('create-temp-file', async (event, fileName, mimeType, data) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(os.tmpdir(), 'recipe-manager')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    
    // Generate unique file path
    const uniqueFileName = `${Date.now()}_${fileName}`
    const filePath = path.join(tempDir, uniqueFileName)
    
    // Extract base64 data and save to file
    const base64Data = data.replace(/^data:\w+\/\w+;base64,/, '')
    fs.writeFileSync(filePath, base64Data, 'base64')
    
    return filePath
  } catch (error) {
    console.error('Temp file creation failed:', error)
    throw error
  }
})