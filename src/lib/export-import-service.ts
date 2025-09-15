// Export/Import service for RecipeBox
// Handles complete database and file export/import functionality

export interface ExportData {
  metadata: {
    version: string;
    exportDate: string;
    appName: string;
  };
  database: {
    recipes: any[];
    tags: any[];
    recipeTags: any[];
  };
  files: {
    [fileName: string]: string; // base64 encoded file data
  };
}

export interface ImportResult {
  success: boolean;
  message: string;
  importedRecipes: number;
  importedTags: number;
  importedFiles: number;
  errors?: string[];
}

class ExportImportService {
  private getIPC(): any {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      return (window as any).electronAPI;
    }
    throw new Error('Electron IPC not available');
  }

  // Export entire database and files
  async exportData(): Promise<Blob> {
    const ipc = this.getIPC();
    
    try {
      // Get all database data
      const recipes = await ipc.databaseOperation('getRecipes');
      const tags = await ipc.databaseOperation('getTags');
      
      // Get all recipe-tag relationships
      const recipeTags = [];
      for (const recipe of recipes) {
        const recipeTagRelations = await ipc.databaseOperation('getRecipeTags', recipe.id);
        for (const tag of recipeTagRelations) {
          recipeTags.push({
            recipeId: recipe.id,
            tagId: tag.id
          });
        }
      }

      // Get all files from uploads directory
      const files = await ipc.exportFiles();

      // Create export data structure
      const exportData: ExportData = {
        metadata: {
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          appName: 'RecipeBox'
        },
        database: {
          recipes,
          tags,
          recipeTags
        },
        files
      };

      // Convert to JSON and create blob
      const jsonData = JSON.stringify(exportData, null, 2);
      return new Blob([jsonData], { type: 'application/json' });
    } catch (error) {
      console.error('Export failed:', error);
      throw new Error('Failed to export data');
    }
  }

  // Import data from file
  async importData(file: File): Promise<ImportResult> {
    const ipc = this.getIPC();
    
    try {
      // Read and parse the import file
      const text = await file.text();
      const importData: ExportData = JSON.parse(text);

      // Validate import data structure
      if (!this.validateImportData(importData)) {
        return {
          success: false,
          message: 'Invalid import file format',
          importedRecipes: 0,
          importedTags: 0,
          importedFiles: 0,
          errors: ['Invalid file format']
        };
      }

      const errors: string[] = [];
      let importedRecipes = 0;
      let importedTags = 0;
      let importedFiles = 0;

      // Import files first (needed for recipe references)
      try {
        const fileImportResult = await ipc.importFiles(importData.files);
        importedFiles = fileImportResult.importedCount;
        if (fileImportResult.errors) {
          errors.push(...fileImportResult.errors);
        }
      } catch (error) {
        errors.push(`File import failed: ${error}`);
      }

      // Import tags
      try {
        for (const tag of importData.database.tags) {
          try {
            // Check if tag already exists
            const existingTag = await ipc.databaseOperation('getTagByName', tag.name);
            if (!existingTag) {
              await ipc.databaseOperation('createTag', { name: tag.name });
              importedTags++;
            }
            // If tag exists, silently skip (no error needed)
          } catch (error) {
            // Only log actual errors, not "already exists" cases
            if (!error.message?.includes('already exists') && !error.message?.includes('UNIQUE constraint')) {
              console.warn(`Error importing tag ${tag.name}:`, error);
            }
          }
        }
      } catch (error) {
        errors.push(`Tag import failed: ${error}`);
      }

      // Import recipes
      try {
        // Get existing recipes to check for duplicates
        const existingRecipes = await ipc.databaseOperation('getRecipes');
        const existingRecipeMap = new Map(existingRecipes.map((r: any) => [r.name.toLowerCase(), r]));
        
        for (const recipe of importData.database.recipes) {
          try {
            // Check if recipe with same name already exists (case-insensitive)
            const existingRecipe = existingRecipeMap.get(recipe.name.toLowerCase());
            if (existingRecipe) {
              console.log(`Replacing existing recipe: ${recipe.name}`);
              // Delete the existing recipe
              await ipc.databaseOperation('deleteRecipe', existingRecipe.id);
            }
            
            // Remove id and tags from recipe data to avoid conflicts
            const { id, tags, ...recipeData } = recipe;
            const newRecipe = await ipc.databaseOperation('createRecipe', recipeData);
            importedRecipes++;
            
            // Update the map with the new recipe to prevent duplicates within the same import
            existingRecipeMap.set(recipe.name.toLowerCase(), newRecipe);

            // Add recipe-tag relationships
            const recipeTagRelations = importData.database.recipeTags.filter(
              rt => rt.recipeId === id
            );
            
            for (const relation of recipeTagRelations) {
              try {
                // Find the corresponding tag by name
                const originalTag = importData.database.tags.find(t => t.id === relation.tagId);
                if (originalTag) {
                  const existingTag = await ipc.databaseOperation('getTagByName', originalTag.name);
                  if (existingTag) {
                    await ipc.databaseOperation('addTagToRecipe', newRecipe.id, existingTag.id);
                  }
                }
              } catch (error) {
                console.warn(`Failed to add tag to recipe ${newRecipe.name}:`, error);
              }
            }
          } catch (error) {
            errors.push(`Failed to import recipe ${recipe.name}: ${error}`);
          }
        }
      } catch (error) {
        errors.push(`Recipe import failed: ${error}`);
      }

      return {
        success: errors.length === 0,
        message: errors.length === 0 
          ? `Successfully imported ${importedRecipes} recipes, ${importedTags} tags, and ${importedFiles} files`
          : `Import completed with ${errors.length} errors`,
        importedRecipes,
        importedTags,
        importedFiles,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error('Import failed:', error);
      return {
        success: false,
        message: 'Failed to import data',
        importedRecipes: 0,
        importedTags: 0,
        importedFiles: 0,
        errors: [error.toString()]
      };
    }
  }

  // Validate import data structure
  private validateImportData(data: any): data is ExportData {
    return (
      data &&
      data.metadata &&
      data.metadata.version &&
      data.metadata.exportDate &&
      data.metadata.appName &&
      data.database &&
      Array.isArray(data.database.recipes) &&
      Array.isArray(data.database.tags) &&
      Array.isArray(data.database.recipeTags) &&
      data.files &&
      typeof data.files === 'object'
    );
  }

  // Download export file
  async downloadExport(): Promise<void> {
    try {
      const blob = await this.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recipebox-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      throw new Error('Failed to download export file');
    }
  }

  // Clear all database data
  async clearDatabase(): Promise<{ success: boolean; message: string }> {
    const ipc = this.getIPC();
    
    try {
      await ipc.databaseOperation('clearDatabase');
      return {
        success: true,
        message: 'Database cleared successfully'
      };
    } catch (error) {
      console.error('Clear database failed:', error);
      return {
        success: false,
        message: `Failed to clear database: ${error}`
      };
    }
  }
}

// Export singleton instance
export const exportImportService = new ExportImportService();
