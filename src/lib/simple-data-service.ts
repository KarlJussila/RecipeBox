// Electron-only data service for Recipe Manager

// Recipe interface
export interface Recipe {
  id: string;
  name: string;
  description?: string;
  sourceUrl?: string;
  fileName?: string;
  fileType?: string;
  filePath?: string;
  cookTime?: number;
  photoPath?: string;
  photoFileName?: string;
  createdAt: string;
  tags: Tag[];
}

// Tag interface
export interface Tag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

class ElectronDataService {
  // Get Electron IPC renderer
  private getIPC(): any {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      return (window as any).electronAPI;
    }
    throw new Error('Electron IPC not available');
  }

  // Execute database operation via IPC
  private async executeDatabaseOperation(operation: string, ...args: any[]): Promise<any> {
    const ipc = this.getIPC();
    
    try {
      const result = await ipc.databaseOperation(operation, ...args);
      return result;
    } catch (error) {
      console.error(`IPC operation ${operation} failed:`, error);
      throw error;
    }
  }

  // Recipe operations
  async getRecipes(): Promise<Recipe[]> {
    const recipes = await this.executeDatabaseOperation('getRecipes');
    // Fetch tags for each recipe
    const recipesWithTags = await Promise.all(
      recipes.map(async (recipe: any) => {
        const tags = await this.executeDatabaseOperation('getRecipeTags', recipe.id);
        return { ...recipe, tags };
      })
    );
    return recipesWithTags;
  }

  async getRecipeById(id: string): Promise<Recipe | null> {
    const recipe = await this.executeDatabaseOperation('getRecipeById', id);
    if (!recipe) return null;
    
    const tags = await this.executeDatabaseOperation('getRecipeTags', id);
    return { ...recipe, tags };
  }

  async createRecipe(data: {
    name: string;
    description?: string;
    sourceUrl?: string;
    tagIds?: string[];
    filePath?: string;
    fileName?: string;
    fileType?: string;
    cookTime?: number;
    photoPath?: string;
    photoFileName?: string;
    tags?: string[];
  }): Promise<Recipe> {
    console.log('💾 SimpleDataService createRecipe called with data:', data)
    console.log('💾 SimpleDataService createRecipe cookTime:', data.cookTime, 'type:', typeof data.cookTime)
    
    const { tagIds, tags, ...recipeData } = data;
    console.log('💾 SimpleDataService createRecipe recipeData (after destructuring):', recipeData)
    console.log('💾 SimpleDataService createRecipe recipeData.cookTime:', recipeData.cookTime, 'type:', typeof recipeData.cookTime)
    
    const recipe = await this.executeDatabaseOperation('createRecipe', recipeData);
    
    // Handle tags if provided
    if (tagIds && tagIds.length > 0) {
      await Promise.all(
        tagIds.map(tagId => 
          this.executeDatabaseOperation('addTagToRecipe', recipe.id, tagId)
        )
      );
    }
    
    // Fetch tags for the created recipe
    const recipeTags = await this.executeDatabaseOperation('getRecipeTags', recipe.id);
    return { ...recipe, tags: recipeTags };
  }

  async updateRecipe(id: string, data: {
    name: string;
    description?: string;
    sourceUrl?: string;
    tagIds?: string[];
    filePath?: string;
    fileName?: string;
    fileType?: string;
    cookTime?: number;
    photoPath?: string;
    photoFileName?: string;
    tags?: string[];
  }): Promise<Recipe | null> {
    const { tagIds, tags, ...recipeData } = data;
    const recipe = await this.executeDatabaseOperation('updateRecipe', id, recipeData);
    if (!recipe) return null;
    
    // Handle tag updates
    if (tagIds !== undefined) {
      // Get current tags
      const currentTags = await this.executeDatabaseOperation('getRecipeTags', id);
      const currentTagIds = currentTags.map((tag: any) => tag.id);
      
      // Remove tags that are no longer needed
      const tagsToRemove = currentTagIds.filter(tagId => !tagIds.includes(tagId));
      await Promise.all(
        tagsToRemove.map(tagId => 
          this.executeDatabaseOperation('removeTagFromRecipe', id, tagId)
        )
      );
      
      // Add new tags
      const tagsToAdd = tagIds.filter(tagId => !currentTagIds.includes(tagId));
      await Promise.all(
        tagsToAdd.map(tagId => 
          this.executeDatabaseOperation('addTagToRecipe', id, tagId)
        )
      );
    }
    
    // Fetch updated tags
    const recipeTags = await this.executeDatabaseOperation('getRecipeTags', id);
    return { ...recipe, tags: recipeTags };
  }

  async deleteRecipe(id: string): Promise<boolean> {
    return await this.executeDatabaseOperation('deleteRecipe', id);
  }

  // Tag operations
  async getTags(): Promise<Tag[]> {
    return await this.executeDatabaseOperation('getTags');
  }

  async createTag(name: string): Promise<Tag> {
    return await this.executeDatabaseOperation('createTag', { name });
  }

  async deleteTag(id: string): Promise<boolean> {
    return await this.executeDatabaseOperation('deleteTag', id);
  }

  // File upload operations
  async uploadFile(file: File): Promise<{ filePath: string; fileName: string; fileType: string }> {
    const ipc = this.getIPC();
    
    try {
      // Convert file to base64 for IPC transfer
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64Data = reader.result as string;
            const result = await ipc.uploadFile({
              fileName: file.name,
              fileType: file.type,
              data: base64Data
            });
            resolve(result);
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    } catch (error) {
      console.error('File upload failed:', error);
      throw new Error('Failed to upload file');
    }
  }

  // Seeding operations (for initial setup)
  async seedDatabase(): Promise<void> {
    try {
      await this.executeDatabaseOperation('seedDatabase');
    } catch (error) {
      console.error('Failed to seed database:', error);
    }
  }
}

// Export singleton instance
export const dataService = new ElectronDataService();