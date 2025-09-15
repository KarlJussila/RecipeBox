import { useState, useEffect, useMemo, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Plus, Search, Filter, Settings, Clock, Menu, X, ChevronDown, ChevronUp } from 'lucide-react'
import RecipeFormDialog from '@/components/recipe-form-dialog'
import RecipeDetailDialog from '@/components/recipe-detail-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import ManageTagsDialog from '@/components/manage-tags-dialog'
import { ExportImportDialog } from '@/components/export-import-dialog'
import { TimeInput } from '@/components/ui/time-input'
import { dataService, Recipe, Tag } from '@/lib/simple-data-service'
import { formatFileType } from '@/lib/utils'

// Component to handle recipe photo display with proper path resolution
function RecipePhotoThumbnail({ photoPath, photoFileName }: { photoPath: string; photoFileName?: string }) {
  const [imageSrc, setImageSrc] = useState<string>('')
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    const loadImagePath = async () => {
      try {
        // Get the user data path from Electron
        const userDataPath = await (window as any).electronAPI?.getUserDataPath?.()
        
        if (userDataPath && photoPath) {
          // Construct the full file path
          const fullPath = `file://${userDataPath}${photoPath}`
          setImageSrc(fullPath)
        }
      } catch (error) {
        console.error('Error loading photo path:', error)
        setImageError(true)
      }
    }

    loadImagePath()
  }, [photoPath])

  if (imageError || !imageSrc) {
    return null
  }

  return (
    <img 
      src={imageSrc}
      alt={photoFileName || 'Recipe photo'}
      className="w-16 h-16 object-cover rounded border flex-shrink-0"
      onError={() => setImageError(true)}
    />
  )
}

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [tagSearchTerm, setTagSearchTerm] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [cookTimeFilterEnabled, setCookTimeFilterEnabled] = useState(false)
  const [maxCookTime, setMaxCookTime] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [scrollY, setScrollY] = useState(0)
  const [windowWidth, setWindowWidth] = useState(0)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isFilterExpanded, setIsFilterExpanded] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Wait for database to be ready in Electron
    console.log('Waiting for database ready...')

    // Proactively query for database path in case the event fired early
    ;(async () => {
      try {
        const dbPath = await (window as any).electronAPI.getDatabasePath?.()
        if (dbPath) {
          console.log('Database path available immediately, fetching data...')
          fetchRecipes()
          fetchTags()
        }
      } catch (e) {
        // Ignore; we'll rely on the event below
      }
    })()

    // Listen for database ready event as a fallback
    const handleDatabaseReady = () => {
      console.log('Database ready, fetching data...')
      fetchRecipes()
      fetchTags()
    }

    ;(window as any).electronAPI.onDatabaseReady(handleDatabaseReady)

    // Clean up listener
    return () => {
      ;(window as any).electronAPI.removeAllListeners('database-ready')
    }
  }, [])

  // Scroll detection and window resize for dynamic sidebar positioning
  useEffect(() => {
    const updateSidebarPosition = () => {
      setScrollY(window.scrollY)
      setWindowWidth(window.innerWidth)
      
      // Update CSS custom property for smooth sidebar positioning
      if (windowWidth >= 1024 && headerRef.current) {
        const headerHeight = headerRef.current.offsetHeight
        const headerBottom = headerHeight
        const scrollY = window.scrollY
        
        // Calculate how much the header is "pushing down" the content
        // When scrollY is 0, header is fully visible and pushes content down by its full height
        // As we scroll, the header slides up and pushes less
        const headerPush = Math.max(0, headerBottom - scrollY)
        
        // Set the top offset: base margin + how much header is pushing
        const topOffset = 24 + headerPush // 24px = 1.5rem base margin
        
        document.documentElement.style.setProperty('--sidebar-top-offset', `${topOffset}px`)
      }
    }

    const handleScroll = () => {
      updateSidebarPosition()
    }

    const handleResize = () => {
      updateSidebarPosition()
    }

    // Set initial values
    updateSidebarPosition()

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize, { passive: true })
    
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
    }
  }, [windowWidth])



  const fetchRecipes = async () => {
    try {
      const data = await dataService.getRecipes()
      setRecipes(data)
      
      // If no recipes exist, seed sample recipes
      if (data.length === 0) {
        await dataService.seedDatabase()
        // Fetch recipes again after seeding
        const seededData = await dataService.getRecipes()
        setRecipes(seededData)
      }
    } catch (error) {
      console.error('Failed to fetch recipes:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTags = async () => {
    try {
      const data = await dataService.getTags()
      
      // If no tags exist, seed the standard tags
      if (data.length === 0) {
        await dataService.seedDatabase()
        // Fetch tags again after seeding
        const seededData = await dataService.getTags()
        setTags(seededData)
      } else {
        setTags(data)
      }
    } catch (error) {
      console.error('Failed to fetch tags:', error)
    }
  }

  const handleAddRecipe = async (formData: any) => {
    console.log('📝 handleAddRecipe called with formData:', formData)
    console.log('📝 handleAddRecipe cookTime:', formData.cookTime, 'type:', typeof formData.cookTime)
    
    try {
      // Handle file upload if present
      let filePath = ''
      let fileName = ''
      let fileType = ''

      if (formData.file) {
        try {
          const uploadData = await dataService.uploadFile(formData.file)
          filePath = uploadData.filePath
          fileName = uploadData.fileName
          fileType = uploadData.fileType
        } catch (error) {
          console.error('File upload failed:', error)
          // Continue without file upload
        }
      }

      // Handle photo upload if present
      let photoPath = ''
      let photoFileName = ''

      if (formData.photo) {
        console.log('📸 Photo upload starting for file:', formData.photo.name)
        try {
          const uploadData = await dataService.uploadFile(formData.photo)
          photoPath = uploadData.filePath
          photoFileName = uploadData.fileName
          console.log('📸 Photo upload successful - path:', photoPath, 'fileName:', photoFileName)
        } catch (error) {
          console.error('Photo upload failed:', error)
          // Continue without photo upload
        }
      }

      const recipeData = {
        name: formData.name,
        description: formData.description,
        sourceUrl: formData.sourceUrl,
        cookTime: formData.cookTime,
        tagIds: formData.tagIds,
        filePath,
        fileName,
        fileType,
        photoPath,
        photoFileName,
        tags: formData.tagIds // For Electron mode
      }
      
      console.log('📝 Creating recipe with data:', recipeData)
      console.log('📝 Recipe cookTime being saved:', recipeData.cookTime, 'type:', typeof recipeData.cookTime)

      // Create recipe
      await dataService.createRecipe(recipeData)

      await fetchRecipes()
    } catch (error) {
      console.error('Error adding recipe:', error)
      throw error
    }
  }

  const handleEditRecipe = async (formData: any) => {
    if (!editingRecipe) return

    try {
      // Handle file upload if present
      let filePath = editingRecipe.filePath || ''
      let fileName = editingRecipe.fileName || ''
      let fileType = editingRecipe.fileType || ''

      if (formData.file) {
        try {
          const uploadData = await dataService.uploadFile(formData.file)
          filePath = uploadData.filePath
          fileName = uploadData.fileName
          fileType = uploadData.fileType
        } catch (error) {
          console.error('File upload failed:', error)
          // Continue without file upload
        }
      }

      // Handle photo upload if present
      let photoPath = editingRecipe.photoPath || ''
      let photoFileName = editingRecipe.photoFileName || ''

      if (formData.photo) {
        try {
          const uploadData = await dataService.uploadFile(formData.photo)
          photoPath = uploadData.filePath
          photoFileName = uploadData.fileName
        } catch (error) {
          console.error('Photo upload failed:', error)
          // Continue without photo upload
        }
      }

      // Update recipe
      await dataService.updateRecipe(editingRecipe.id, {
        name: formData.name,
        description: formData.description,
        sourceUrl: formData.sourceUrl,
        cookTime: formData.cookTime,
        tagIds: formData.tagIds,
        filePath,
        fileName,
        fileType,
        photoPath,
        photoFileName,
        tags: formData.tagIds // For Electron mode
      })

      await fetchRecipes()
      setEditingRecipe(null)
    } catch (error) {
      console.error('Error updating recipe:', error)
      throw error
    }
  }

  const handleDeleteRecipe = async (recipeId: string) => {
    try {
      await dataService.deleteRecipe(recipeId)
      await fetchRecipes()
    } catch (error) {
      console.error('Error deleting recipe:', error)
      throw error
    }
  }

  const handleCreateTag = async (tagName: string) => {
    try {
      const newTag = await dataService.createTag(tagName)
      // Add the new tag to the existing tags array instead of refetching
      setTags(prevTags => [...prevTags, newTag])
      return newTag // Return the created tag
    } catch (error) {
      console.error('Error creating tag:', error)
      throw error
    }
  }

  const handleTagsChange = () => {
    fetchTags()
    fetchRecipes() // Also refresh recipes to update tag associations
  }

  const handleDataRefresh = () => {
    fetchRecipes()
    fetchTags()
  }

  const handleMobileMenuAction = () => {
    setIsMobileMenuOpen(false)
  }

  const filteredRecipes = recipes.filter(recipe => {
    const matchesSearch = recipe.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         recipe.description?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesTags = selectedTags.length === 0 || 
                       selectedTags.every(tagId => 
                         recipe.tags.some(tag => tag.id === tagId)
                       )
    
    const matchesCookTime = !cookTimeFilterEnabled || 
                           (maxCookTime !== undefined && 
                            recipe.cookTime !== undefined && 
                            recipe.cookTime !== null && 
                            recipe.cookTime <= maxCookTime)
    
    return matchesSearch && matchesTags && matchesCookTime
  })

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev => 
      prev.includes(tagId) 
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    )
  }

  const clearFilters = () => {
    setSearchTerm('')
    setSelectedTags([])
    setTagSearchTerm('')
    setCookTimeFilterEnabled(false)
    setMaxCookTime(undefined)
  }

  const handleRecipeClick = (recipe: Recipe) => {
    setSelectedRecipe(recipe)
    setShowDetailDialog(true)
  }

  const handleEditClick = (recipe: Recipe) => {
    setEditingRecipe(recipe)
    setShowDetailDialog(false)
  }

  // Memoize initialData to prevent unnecessary re-renders
  const editInitialData = useMemo(() => {
    return editingRecipe ? {
      name: editingRecipe.name,
      description: editingRecipe.description,
      sourceUrl: editingRecipe.sourceUrl,
      cookTime: editingRecipe.cookTime,
      tagIds: editingRecipe.tags.map(tag => tag.id)
    } : undefined
  }, [editingRecipe])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading recipes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header ref={headerRef} className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">RecipeBox</h1>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              
              {/* Desktop buttons - hidden on mobile */}
              <div className="hidden md:flex items-center gap-2">
                <ExportImportDialog onDataChanged={handleDataRefresh} />
                <ManageTagsDialog onTagsChange={handleTagsChange}>
                  <Button variant="outline">
                    <Settings className="w-4 h-4 mr-2" />
                    Manage Tags
                  </Button>
                </ManageTagsDialog>
                <Button onClick={() => setShowAddDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Recipe
                </Button>
              </div>

              {/* Mobile hamburger menu */}
              <div className="md:hidden">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                >
                  {isMobileMenuOpen ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Menu className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile menu dropdown */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-b bg-background border-t-0">
          <div className="container mx-auto px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <ExportImportDialog 
                onDataChanged={handleDataRefresh} 
                triggerClassName="flex-1 min-w-0" 
              />
              <ManageTagsDialog onTagsChange={handleTagsChange}>
                <Button variant="outline" className="flex-1 min-w-0">
                  <Settings className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Manage Tags</span>
                  <span className="sm:hidden">Tags</span>
                </Button>
              </ManageTagsDialog>
              <Button onClick={() => setShowAddDialog(true)} className="flex-1 min-w-0">
                <Plus className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Add Recipe</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      <div 
        ref={containerRef} 
        className="container mx-auto px-4 py-6"
        style={{
          ...(windowWidth >= 1024 && {
            maxWidth: 'none',
            width: '100%'
          })
        }}
      >
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar with filters */}
          <div className="lg:w-64 lg:flex-shrink-0">
            <div 
              className="lg:sticky lg:top-6"
              style={{
                ...(windowWidth >= 1024 && {
                  position: 'fixed',
                  top: 'var(--sidebar-top-offset, 1.5rem)',
                  bottom: '1.5rem',
                  left: '1.5rem',
                  width: '16rem',
                  height: 'auto',
                  zIndex: 10
                })
              }}
            >
              <Card className="h-full flex flex-col min-h-0">
                <CardHeader 
                  className="flex-shrink-0 cursor-pointer lg:cursor-default"
                  onClick={() => windowWidth < 1024 && setIsFilterExpanded(!isFilterExpanded)}
                >
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Filter className="w-4 h-4" />
                      Filters
                    </CardTitle>
                    {/* Collapse button for narrow screens */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="lg:hidden"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsFilterExpanded(!isFilterExpanded);
                      }}
                    >
                      {isFilterExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </CardHeader>
                                 {/* Filter content - always visible on large screens, conditional on narrow screens */}
                 <div className={`lg:block ${isFilterExpanded ? 'block' : 'hidden'}`}>
                 <CardContent className="p-0 h-full flex flex-col">
                   {/* Search Section */}
                   <div className="p-6 pb-4">
                     <label className="text-sm font-medium mb-2 block">Search</label>
                     <div className="relative">
                       <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                       <Input
                         placeholder="Search recipes..."
                         value={searchTerm}
                         onChange={(e) => setSearchTerm(e.target.value)}
                         className="pl-10"
                       />
                     </div>
                   </div>

                   <Separator />

                   {/* Tags Section */}
                   <div className="p-6 pt-4">
                     <label className="text-sm font-medium mb-2 block">Tags</label>
                     
                     {/* Tag Search Box */}
                     <div className="relative mb-3">
                       <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                       <Input
                         placeholder="Search tags..."
                         value={tagSearchTerm}
                         onChange={(e) => setTagSearchTerm(e.target.value)}
                         className="pl-10"
                       />
                     </div>

                     {/* Tags List - Fill remaining space and scroll */}
                     <div 
                       className="overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
                       style={{
                         height: windowWidth >= 1024 
                           ? 'calc(100vh - var(--sidebar-top-offset, 1.5rem) - 1.5rem - 32rem)'
                           : '12rem'
                       }}
                     >
                       <div className="flex flex-wrap gap-2 pr-2">
                         {tags
                           .filter(tag => 
                             tagSearchTerm === '' || 
                             tag.name.toLowerCase().includes(tagSearchTerm.toLowerCase())
                           )
                           .map((tag) => (
                             <Badge
                               key={tag.id}
                               variant={selectedTags.includes(tag.id) ? "default" : "outline"}
                               className={`px-3 py-1.5 rounded-full cursor-pointer transition-colors text-sm ${
                                 selectedTags.includes(tag.id)
                                   ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                   : 'hover:bg-muted'
                               }`}
                               onClick={() => toggleTag(tag.id)}
                             >
                               {tag.name}
                             </Badge>
                           ))}
                       </div>
                     </div>
                   </div>


                   {/* Bottom Section */}
                   <div>
                     <Separator />
                     
                     {/* Cook Time Filter */}
                     <div className="p-6 pt-4">
                       <div className="flex items-center justify-between mb-2">
                         <Label className="text-sm font-medium flex items-center gap-2">
                           <Clock className="w-4 h-4" />
                           Max Cook Time
                         </Label>
                         <Switch
                           checked={cookTimeFilterEnabled}
                           onCheckedChange={setCookTimeFilterEnabled}
                         />
                       </div>
                       <div className={`space-y-2 transition-opacity duration-200 ${!cookTimeFilterEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                         <TimeInput
                           value={maxCookTime}
                           onChange={setMaxCookTime}
                           placeholder="00:00"
                           disabled={!cookTimeFilterEnabled}
                         />
                         <p className="text-xs text-muted-foreground">
                           Show recipes with cook time ≤ this value
                         </p>
                       </div>
                     </div>

                     {/* Clear Filters Button */}
                     {(searchTerm || selectedTags.length > 0 || cookTimeFilterEnabled) && (
                       <>
                         <Separator />
                         <div className="p-6 pt-4">
                           <Button variant="outline" onClick={clearFilters} className="w-full">
                             Clear Filters
                           </Button>
                         </div>
                       </>
                     )}
                   </div>
                 </CardContent>
                 </div>
              </Card>
            </div>
          </div>

          {/* Main content with recipe list */}
          <div 
            className="flex-1"
            style={{
              ...(windowWidth >= 1024 && {
                marginLeft: '1.5rem', // Just a small gap from the sidebar
                marginRight: '1.5rem' // Match the gap on the right
              })
            }}
          >
            <div className="mb-6">
              <h2 className="text-2xl font-semibold mb-2">
                Recipes ({filteredRecipes.length})
              </h2>
              <p className="text-muted-foreground">
                {selectedTags.length > 0 || cookTimeFilterEnabled
                  ? `Filtered by ${[
                      selectedTags.length > 0 ? `${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''}` : null,
                      cookTimeFilterEnabled ? 'cook time' : null
                    ].filter(Boolean).join(' and ')}`
                  : 'All recipes'}
              </p>
            </div>

            {filteredRecipes.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold mb-2">No recipes found</h3>
                    <p className="text-muted-foreground mb-4">
                      {searchTerm || selectedTags.length > 0
                        ? 'Try adjusting your filters or search terms.'
                        : 'Get started by adding your first recipe!'}
                    </p>
                    <Button onClick={() => setShowAddDialog(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Recipe
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div 
                className="grid gap-4"
                style={{
                  gridTemplateColumns: windowWidth >= 1024 
                    ? `repeat(auto-fit, minmax(280px, 1fr))`
                    : windowWidth >= 768 
                    ? 'repeat(2, 1fr)'
                    : '1fr'
                }}
              >
                {filteredRecipes.map((recipe) => (
                  <Card 
                    key={recipe.id} 
                    className="hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => handleRecipeClick(recipe)}
                  >
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        {recipe.photoPath && (
                          <RecipePhotoThumbnail 
                            photoPath={recipe.photoPath}
                            photoFileName={recipe.photoFileName}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-lg">{recipe.name}</CardTitle>
                          {recipe.description && (
                            <CardDescription className="line-clamp-2">
                              {recipe.description}
                            </CardDescription>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {recipe.fileName && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
                            <span className="truncate" title={recipe.fileName}>{recipe.fileName}</span>
                            {recipe.fileType && (
                              <Badge variant="outline" className="text-xs flex-shrink-0">
                                {formatFileType(recipe.fileType)}
                              </Badge>
                            )}
                          </div>
                        )}
                        
                        {recipe.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {recipe.tags.map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="secondary"
                                className="text-xs px-3 py-1 rounded-full"
                              >
                                {tag.name}
                              </Badge>
                            ))}
                          </div>
                        )}

                        <div className="text-xs text-muted-foreground">
                          Added {new Date(recipe.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Recipe Dialog */}
      <RecipeFormDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={handleAddRecipe}
        availableTags={tags}
        onCreateTag={handleCreateTag}
      />

      {/* Edit Recipe Dialog */}
      <RecipeFormDialog
        open={!!editingRecipe}
        onOpenChange={(open) => !open && setEditingRecipe(null)}
        onSubmit={handleEditRecipe}
        initialData={editInitialData}
        availableTags={tags}
        onCreateTag={handleCreateTag}
      />

      {/* Recipe Detail Dialog */}
      <RecipeDetailDialog
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
        recipe={selectedRecipe}
        onEdit={handleEditClick}
        onDelete={handleDeleteRecipe}
      />
    </div>
  )
}
