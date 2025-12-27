'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ExternalLink, Download, FileText, Calendar, Edit, Trash2, X as XIcon } from 'lucide-react'
import { formatFileType } from '@/lib/utils'
import { formatCookTime } from '@/components/ui/time-input'

// Component to handle recipe photo display with proper path resolution
function RecipePhoto({ photoPath, photoFileName }: { photoPath: string; photoFileName?: string }) {
  const [imageSrc, setImageSrc] = useState<string>('')
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    const loadImagePath = async () => {
      try {
        console.log('📸 RecipePhoto loading photoPath:', photoPath)
        
        // Get the user data path from Electron
        const userDataPath = await (window as any).electronAPI?.getUserDataPath?.()
        console.log('📸 RecipePhoto userDataPath:', userDataPath)
        
        if (userDataPath && photoPath) {
          // Construct the full file path
          const fullPath = `file://${userDataPath}${photoPath}`
          console.log('📸 RecipePhoto fullPath:', fullPath)
          setImageSrc(fullPath)
        }
      } catch (error) {
        console.error('📸 RecipePhoto error loading path:', error)
        setImageError(true)
      }
    }

    loadImagePath()
  }, [photoPath])

  if (imageError || !imageSrc) {
    return (
      <div className="text-center text-muted-foreground p-4">
        <p>Photo could not be loaded</p>
        <p className="text-sm">Path: {photoPath}</p>
      </div>
    )
  }

  return (
    <img 
      src={imageSrc}
      alt={photoFileName || 'Recipe photo'}
      className="max-w-full max-h-96 object-contain rounded-lg border shadow-sm"
      onError={(e) => {
        console.error('📸 Image failed to load:', e.currentTarget.src)
        setImageError(true)
      }}
      onLoad={() => {
        console.log('📸 Image loaded successfully:', photoPath)
      }}
    />
  )
}

interface Tag {
  id: string
  name: string
}

interface Recipe {
  id: string
  name: string
  description?: string
  sourceUrl?: string
  fileName?: string
  fileType?: string
  filePath?: string
  cookTime?: number
  photoPath?: string
  photoFileName?: string
  createdAt: string
  tags: Tag[]
}

interface RecipeDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe: Recipe | null
  onEdit?: (recipe: Recipe) => void
  onDelete?: (recipeId: string) => Promise<void>
}

export default function RecipeDetailDialog({
  open,
  onOpenChange,
  recipe,
  onEdit,
  onDelete
}: RecipeDetailDialogProps) {
  const [deleteLoading, setDeleteLoading] = useState(false)

  const handleDelete = async () => {
    if (!recipe || !onDelete) return

    setDeleteLoading(true)
    try {
      await onDelete(recipe.id)
      onOpenChange(false)
    } catch (error) {
      console.error('Error deleting recipe:', error)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!recipe?.filePath) return
    
    try {
      const result = await (window as any).electronAPI.downloadFile(
        recipe.filePath, 
        recipe.fileName || recipe.name
      )
      
      if (result.success) {
        console.log('File downloaded successfully to:', result.savedPath)
      } else if (result.canceled) {
        console.log('Download canceled by user')
      }
    } catch (error) {
      console.error('Download failed:', error)
      alert('Failed to download file. Please try again.')
    }
  }

  const handleOpen = async () => {
    if (!recipe?.filePath) return
  
    try {
      const result = await (window as any).electronAPI.openFile(recipe.filePath)
      if (result) {
        console.error('Failed to open file:', result)
        alert('Failed to open file:\n' + result)
      }
    } catch (error) {
      console.error('Error opening file:', error)
      alert('An error occurred while trying to open the file.')
    }
  }  

  if (!recipe) return null

  console.log('👁️ RecipeDetailDialog rendering recipe:', recipe)
  console.log('👁️ RecipeDetailDialog recipe.cookTime:', recipe.cookTime, 'type:', typeof recipe.cookTime)
  console.log('👁️ RecipeDetailDialog recipe.photoPath:', recipe.photoPath, 'recipe.photoFileName:', recipe.photoFileName)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] p-0 flex flex-col" showCloseButton={false}>
        {/* Header with title */}
        <DialogHeader className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-2xl mb-2">{recipe.name}</DialogTitle>
              {/* Cook Time - right below recipe name */}
              {recipe.cookTime && (
                <div className="text-sm text-muted-foreground font-medium">
                  Cook Time: {formatCookTime(recipe.cookTime)}
                </div>
              )}
            </div>
            
            {/* Custom close button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0 rounded-full hover:bg-muted"
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        {/* Scrollable content area */}
        <ScrollArea className="flex-1 overflow-y-auto px-6 overflow-x-hidden max-w-full">
          <div className="space-y-4 pb-4 overflow-x-hidden max-w-full">
            {/* Recipe Photo */}
            {recipe.photoPath && (
              <div className="flex justify-center max-w-full">
                <RecipePhoto 
                  photoPath={recipe.photoPath}
                  photoFileName={recipe.photoFileName}
                />
              </div>
            )}
            
            {/* Description - moved to scrollable area */}
            {recipe.description && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Description</h3>
                <div className="text-muted-foreground leading-relaxed">
                  {recipe.description}
                </div>
              </div>
            )}
            {/* Recipe Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Date Created */}
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Date Added</p>
                      <p className="text-muted-foreground">
                        {new Date(recipe.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Source URL */}
              {recipe.sourceUrl && (
                <Card 
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => window.open(recipe.sourceUrl, '_blank', 'noopener,noreferrer')}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <ExternalLink className="w-4 h-4 text-muted-foreground" />
                      <div className="flex-1">
                        <p className="font-medium">Source</p>
                        <p className="text-primary hover:underline text-xs block truncate">
                          View Original Recipe
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Tags */}
            {recipe.tags.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Categories</h3>
                <div className="flex flex-wrap gap-2">
                  {recipe.tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="default"
                      className="px-3 py-1 rounded-full"
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Recipe File Section */}
            {recipe.filePath && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Recipe Document</h3>
                <Card>
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* File info row */}
                      <div className="flex items-start gap-4 w-full max-w-full overflow-hidden">
                        <div className="p-2 bg-muted rounded-lg">
                          <FileText className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0 w-full max-w-full overflow-hidden">
                          <p className="font-medium truncate max-w-full overflow-hidden" style={{overflowWrap: 'anywhere'}} title={recipe.fileName}>
                            {recipe.fileName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {formatFileType(recipe.fileType || '')} • Click download to view
                          </p>
                        </div>
                      </div>
                      
                      {/* Download button on separate row */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button onClick={handleOpen} className="w-full sm:w-auto">
                          <FileText className="w-4 h-4 mr-2" />
                          Open File
                        </Button>
                        <Button onClick={handleDownload} className="w-full sm:w-auto" variant="secondary">
                          <Download className="w-4 h-4 mr-2" />
                          Download File
                        </Button>
                      </div>

                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Fixed footer with action buttons */}
        <div className="flex justify-end gap-2 p-6 pt-4 border-t flex-shrink-0">
          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={deleteLoading}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{recipe?.name}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {onEdit && (
            <Button onClick={() => onEdit(recipe)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit Recipe
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}