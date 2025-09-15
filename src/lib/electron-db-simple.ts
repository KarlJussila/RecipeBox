// Simple database implementation using sql.js
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// Define types for our database models
export interface Recipe {
  id: string;
  name: string;
  description?: string;
  sourceUrl?: string;
  instructions?: string;
  cookTime?: number;
  filePath?: string;
  fileName?: string;
  fileType?: string;
  photoPath?: string;
  photoFileName?: string;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeTag {
  recipeId: string;
  tagId: string;
}

// Simple database class
class SimpleDatabase {
  private db: any;
  private dbPath: string;
  private SQL: any;

  constructor(dbPath?: string) {
    // Determine database path
    if (dbPath) {
      this.dbPath = dbPath;
    } else if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
      // In Electron main process
      const { app } = require('electron');
      this.dbPath = path.join(app.getPath('userData'), 'recipe-manager.db');
    } else {
      // Fallback
      this.dbPath = path.join(process.cwd(), 'db', 'recipe-manager.db');
    }

    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  async initialize() {
    try {
      // Initialize sql.js
      this.SQL = await initSqlJs();
      
      // Check if database file exists
      if (fs.existsSync(this.dbPath)) {
        console.log('Loading existing database from:', this.dbPath);
        try {
          const data = fs.readFileSync(this.dbPath);
          this.db = new this.SQL.Database(data);
          console.log('Database loaded successfully');
        } catch (loadError) {
          console.warn('Failed to load existing database, creating new one:', loadError instanceof Error ? loadError.message : String(loadError));
          this.db = new this.SQL.Database();
          this.createTables();
        }
      } else {
        console.log('Creating new database at:', this.dbPath);
        this.db = new this.SQL.Database();
        this.createTables();
      }
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private createTables() {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        sourceUrl TEXT,
        instructions TEXT,
        cookTime INTEGER,
        filePath TEXT,
        fileName TEXT,
        fileType TEXT,
        photoPath TEXT,
        photoFileName TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#3B82F6',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recipe_tags (
        recipeId TEXT NOT NULL,
        tagId TEXT NOT NULL,
        PRIMARY KEY (recipeId, tagId)
      );
    `);
    
    this.saveDatabase();
  }

  private saveDatabase() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  private escapeString(str: string | null | undefined): string {
    if (str === null || str === undefined) {
      return 'NULL';
    }
    return `'${str.replace(/'/g, "''")}'`;
  }

  // Recipe operations
  async createRecipe(data: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): Promise<Recipe> {
    const id = `recipe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const recipe: Recipe = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    const sql = `
      INSERT INTO recipes (id, name, description, sourceUrl, instructions, cookTime, filePath, fileName, fileType, photoPath, photoFileName, createdAt, updatedAt)
      VALUES (${this.escapeString(recipe.id)}, ${this.escapeString(recipe.name)}, ${this.escapeString(recipe.description)}, ${this.escapeString(recipe.sourceUrl)}, ${this.escapeString(recipe.instructions)}, ${recipe.cookTime || 'NULL'}, ${this.escapeString(recipe.filePath)}, ${this.escapeString(recipe.fileName)}, ${this.escapeString(recipe.fileType)}, ${this.escapeString(recipe.photoPath)}, ${this.escapeString(recipe.photoFileName)}, ${this.escapeString(recipe.createdAt)}, ${this.escapeString(recipe.updatedAt)})
    `;
    
    this.db.run(sql);
    
    this.saveDatabase();
    return recipe;
  }

  async getRecipes(): Promise<Recipe[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const result = this.db.exec('SELECT * FROM recipes ORDER BY createdAt DESC');
    if (result.length > 0) {
      return result[0].values.map((row: any[]) => {
        const recipe: any = {};
        const columns = result[0].columns;
        columns.forEach((col: string, index: number) => {
          recipe[col] = row[index];
        });
        return recipe;
      }) as Recipe[];
    }
    return [];
  }

  async getRecipeById(id: string): Promise<Recipe | null> {
    const result = this.db.exec('SELECT * FROM recipes WHERE id = ?', [id]);
    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      const recipe: any = {};
      const columns = result[0].columns;
      columns.forEach((col: string, index: number) => {
        recipe[col] = row[index];
      });
      return recipe as Recipe;
    }
    return null;
  }

  async updateRecipe(id: string, data: Partial<Recipe>): Promise<boolean> {
    const now = new Date().toISOString();
    const sql = `
      UPDATE recipes 
      SET name = ${this.escapeString(data.name)}, 
          description = ${this.escapeString(data.description)}, 
          sourceUrl = ${this.escapeString(data.sourceUrl)}, 
          instructions = ${this.escapeString(data.instructions)}, 
          cookTime = ${data.cookTime || 'NULL'}, 
          filePath = ${this.escapeString(data.filePath)}, 
          fileName = ${this.escapeString(data.fileName)}, 
          fileType = ${this.escapeString(data.fileType)}, 
          photoPath = ${this.escapeString(data.photoPath)}, 
          photoFileName = ${this.escapeString(data.photoFileName)}, 
          updatedAt = ${this.escapeString(now)}
      WHERE id = ${this.escapeString(id)}
    `;
    
    this.db.run(sql);
    
    this.saveDatabase();
    return true;
  }

  async deleteRecipe(id: string, userDataPath?: string): Promise<boolean> {
    // First get the recipe to find associated files
    const recipe = await this.getRecipeById(id);
    
    // Delete the recipe from database
    this.db.run('DELETE FROM recipes WHERE id = ?', [id]);
    
    // Delete associated files if they exist
    if (recipe && userDataPath) {
      try {
        // Delete recipe file
        if (recipe.filePath) {
          const fullFilePath = path.join(userDataPath, recipe.filePath);
          if (fs.existsSync(fullFilePath)) {
            fs.unlinkSync(fullFilePath);
            console.log('Deleted recipe file:', fullFilePath);
          }
        }
        
        // Delete photo file
        if (recipe.photoPath) {
          const fullPhotoPath = path.join(userDataPath, recipe.photoPath);
          if (fs.existsSync(fullPhotoPath)) {
            fs.unlinkSync(fullPhotoPath);
            console.log('Deleted photo file:', fullPhotoPath);
          }
        }
      } catch (error) {
        console.error('Error deleting associated files:', error);
        // Continue with recipe deletion even if file deletion fails
      }
    }
    
    this.saveDatabase();
    return true;
  }

  // Tag operations
  async createTag(data: Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tag> {
    if (!data.name || data.name.trim() === '') {
      throw new Error('Tag name is required');
    }
    
    const id = `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const tag: Tag = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    const sql = `
      INSERT OR IGNORE INTO tags (id, name, color, createdAt, updatedAt)
      VALUES (${this.escapeString(tag.id)}, ${this.escapeString(tag.name)}, ${this.escapeString(tag.color || '#3B82F6')}, ${this.escapeString(tag.createdAt)}, ${this.escapeString(tag.updatedAt)})
    `;
    
    this.db.run(sql);
    
    this.saveDatabase();
    return tag;
  }

  async getTags(): Promise<Tag[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const result = this.db.exec('SELECT * FROM tags ORDER BY name');
    if (result.length > 0) {
      return result[0].values.map((row: any[]) => {
        const tag: any = {};
        const columns = result[0].columns;
        columns.forEach((col: string, index: number) => {
          tag[col] = row[index];
        });
        return tag;
      }) as Tag[];
    }
    return [];
  }

  async getRecipeTags(recipeId: string): Promise<Tag[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.getTagsForRecipe(recipeId);
  }

  async getTagById(id: string): Promise<Tag | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const result = this.db.exec(`SELECT * FROM tags WHERE id = ${this.escapeString(id)}`);
    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      const tag: any = {};
      const columns = result[0].columns;
      columns.forEach((col: string, index: number) => {
        tag[col] = row[index];
      });
      return tag as Tag;
    }
    return null;
  }

  async getTagByName(name: string): Promise<Tag | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const result = this.db.exec(`SELECT * FROM tags WHERE name = ${this.escapeString(name)}`);
    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      const tag: any = {};
      const columns = result[0].columns;
      columns.forEach((col: string, index: number) => {
        tag[col] = row[index];
      });
      return tag as Tag;
    }
    return null;
  }

  async updateTag(id: string, data: Partial<Tag>): Promise<boolean> {
    const now = new Date().toISOString();
    const sql = `
      UPDATE tags 
      SET name = ?, color = ?, updatedAt = ?
      WHERE id = ?
    `;
    
    this.db.run(sql, [
      data.name,
      data.color || '#3B82F6',
      now,
      id
    ]);
    
    this.saveDatabase();
    return true;
  }

  async deleteTag(id: string): Promise<boolean> {
    this.db.run('DELETE FROM tags WHERE id = ?', [id]);
    this.saveDatabase();
    return true;
  }

  // Recipe-Tag operations
  async addTagToRecipe(recipeId: string, tagId: string): Promise<void> {
    this.db.run('INSERT OR IGNORE INTO recipe_tags (recipeId, tagId) VALUES (?, ?)', [recipeId, tagId]);
    this.saveDatabase();
  }

  async removeTagFromRecipe(recipeId: string, tagId: string): Promise<boolean> {
    this.db.run('DELETE FROM recipe_tags WHERE recipeId = ? AND tagId = ?', [recipeId, tagId]);
    this.saveDatabase();
    return true;
  }

  async getTagsForRecipe(recipeId: string): Promise<Tag[]> {
    const result = this.db.exec(`
      SELECT t.* FROM tags t
      INNER JOIN recipe_tags rt ON t.id = rt.tagId
      WHERE rt.recipeId = ?
    `, [recipeId]);
    
    if (result.length > 0) {
      return result[0].values.map((row: any[]) => {
        const tag: any = {};
        const columns = result[0].columns;
        columns.forEach((col: string, index: number) => {
          tag[col] = row[index];
        });
        return tag;
      }) as Tag[];
    }
    return [];
  }

  async searchRecipes(searchTerm: string): Promise<Recipe[]> {
    const result = this.db.exec(`
      SELECT * FROM recipes 
      WHERE name LIKE ? OR description LIKE ? OR instructions LIKE ?
      ORDER BY createdAt DESC
    `, [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`]);
    
    if (result.length > 0) {
      return result[0].values.map((row: any[]) => {
        const recipe: any = {};
        const columns = result[0].columns;
        columns.forEach((col: string, index: number) => {
          recipe[col] = row[index];
        });
        return recipe;
      }) as Recipe[];
    }
    return [];
  }

  async clearDatabase(userDataPath?: string): Promise<void> {
    // Clear database records
    this.db.exec('DELETE FROM recipe_tags');
    this.db.exec('DELETE FROM tags');
    this.db.exec('DELETE FROM recipes');
    
    // Clean up all files in uploads directory
    if (userDataPath) {
      try {
        const uploadsDir = path.join(userDataPath, 'uploads');
        if (fs.existsSync(uploadsDir)) {
          // Remove all files in the uploads directory
          const files = fs.readdirSync(uploadsDir);
          for (const file of files) {
            const filePath = path.join(uploadsDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              fs.unlinkSync(filePath);
              console.log('Deleted orphaned file:', filePath);
            }
          }
          console.log(`Cleaned up ${files.length} files from uploads directory`);
        }
      } catch (error) {
        console.error('Error cleaning up uploads directory:', error);
        // Continue with database clearing even if file cleanup fails
      }
    }
    
    this.saveDatabase();
  }

  async cleanupOrphanedFiles(userDataPath?: string): Promise<{ deletedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let deletedCount = 0;

    if (!userDataPath) {
      return { deletedCount: 0, errors: ['No user data path provided'] };
    }

    try {
      // Get all file paths referenced in the database
      const recipes = await this.getRecipes();
      const referencedFiles = new Set<string>();
      
      recipes.forEach(recipe => {
        if (recipe.filePath) {
          referencedFiles.add(recipe.filePath);
        }
        if (recipe.photoPath) {
          referencedFiles.add(recipe.photoPath);
        }
      });

      // Check uploads directory for orphaned files
      const uploadsDir = path.join(userDataPath, 'uploads');
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
          const filePath = path.join(uploadsDir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            const relativePath = path.relative(userDataPath, filePath);
            if (!referencedFiles.has(relativePath)) {
              try {
                fs.unlinkSync(filePath);
                console.log('Deleted orphaned file:', filePath);
                deletedCount++;
              } catch (error) {
                const errorMsg = `Failed to delete ${filePath}: ${error}`;
                console.error(errorMsg);
                errors.push(errorMsg);
              }
            }
          }
        }
      }
    } catch (error) {
      const errorMsg = `Error during cleanup: ${error}`;
      console.error(errorMsg);
      errors.push(errorMsg);
    }

    return { deletedCount, errors };
  }

  close(): void {
    if (this.db) {
      // Save database before closing
      this.saveDatabase();
      this.db.close();
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }
}

// Export a singleton instance
let dbInstance: SimpleDatabase | null = null;
let initializationPromise: Promise<SimpleDatabase> | null = null;

export async function getElectronDb(dbPath?: string): Promise<SimpleDatabase> {
  if (!dbInstance) {
    if (!initializationPromise) {
      console.log('Creating new database instance...');
      initializationPromise = (async () => {
        const instance = new SimpleDatabase(dbPath);
        await instance.initialize();
        console.log('Database instance created and initialized');
        return instance;
      })();
    }
    dbInstance = await initializationPromise;
  } else {
    // Using existing database instance
  }
  return dbInstance;
}

// Export types for use in other modules
export type { SimpleDatabase };
