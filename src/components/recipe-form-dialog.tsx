'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { TimeInput } from '@/components/ui/time-input'
import { Upload, X, Plus, Search } from 'lucide-react'

interface Tag {
  id: string
  name: string
}

interface RecipeFormData {
  name: string
  description?: string
  sourceUrl?: string
  cookTime?: number
  tagIds: string[]
  file?: File
  photo?: File
}

interface RecipeFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: RecipeFormData) => Promise<void>
  initialData?: Partial<RecipeFormData>
  availableTags: Tag[]
  onCreateTag?: (tagName: string) => Promise<Tag>
}

export default function RecipeFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  availableTags,
  onCreateTag
}: RecipeFormDialogProps) {
  const [formData, setFormData] = useState<RecipeFormData>({
    name: '',
    description: '',
    sourceUrl: '',
    cookTime: undefined,
    tagIds: [],
    file: undefined,
    photo: undefined
  })
  
  const [loading, setLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [photoDragActive, setPhotoDragActive] = useState(false)
  const [tagSearchTerm, setTagSearchTerm] = useState('')
  const [creatingTag, setCreatingTag] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || '',
        description: initialData.description || '',
        sourceUrl: initialData.sourceUrl || '',
        cookTime: initialData.cookTime,
        tagIds: initialData.tagIds || [],
        file: initialData.file || undefined,
        photo: initialData.photo || undefined
      })
    } else {
      setFormData({
        name: '',
        description: '',
        sourceUrl: '',
        cookTime: undefined,
        tagIds: [],
        file: undefined,
        photo: undefined
      })
    }
    setTagSearchTerm('') // Reset search term when dialog opens
  }, [initialData, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    console.log('🍳 RecipeForm handleSubmit - formData:', formData)
    console.log('🍳 RecipeForm handleSubmit - cookTime:', formData.cookTime, 'type:', typeof formData.cookTime)
    
    if (!formData.name.trim()) {
      return
    }

    setLoading(true)
    try {
      await onSubmit(formData)
      onOpenChange(false)
    } catch (error) {
      console.error('Error submitting recipe:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      setFormData(prev => ({ ...prev, file }))
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setFormData(prev => ({ ...prev, file }))
    }
  }

  const removeFile = () => {
    setFormData(prev => ({ ...prev, file: undefined }))
  }

  const handlePhotoDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setPhotoDragActive(true)
    } else if (e.type === 'dragleave') {
      setPhotoDragActive(false)
    }
  }

  const handlePhotoDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPhotoDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      // Check if it's an image file
      if (file.type.startsWith('image/')) {
        setFormData(prev => ({ ...prev, photo: file }))
      }
    }
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (file.type.startsWith('image/')) {
        setFormData(prev => ({ ...prev, photo: file }))
      }
    }
  }

  const removePhoto = () => {
    setFormData(prev => ({ ...prev, photo: undefined }))
  }

  const toggleTag = (tagId: string) => {
    setFormData(prev => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter(id => id !== tagId)
        : [...prev.tagIds, tagId]
    }))
  }

  const handleCreateTag = async () => {
    if (!tagSearchTerm.trim() || !onCreateTag) return
    
    setCreatingTag(true)
    try {
      const newTag = await onCreateTag(tagSearchTerm.trim())
      // Automatically add the newly created tag to the selected tags
      setFormData(prev => ({
        ...prev,
        tagIds: [...prev.tagIds, newTag.id]
      }))
      setTagSearchTerm('') // Clear search after creating tag
    } catch (error) {
      console.error('Error creating tag:', error)
    } finally {
      setCreatingTag(false)
    }
  }

  const selectedTags = availableTags.filter(tag => formData.tagIds.includes(tag.id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 flex flex-col" showCloseButton={false}>
        <DialogHeader className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle>
                {initialData ? 'Edit Recipe' : 'Add New Recipe'}
              </DialogTitle>
              <DialogDescription>
                Fill in the recipe details. Only the name is required.
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 p-0 rounded-full hover:bg-muted"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6">
            <div className="space-y-4 pb-4">
              {/* Recipe Name */}
              <div className="space-y-1">
                <Label htmlFor="name">Recipe Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter recipe name"
                  required
                />
              </div>

              {/* Cook Time - right below recipe name */}
              <div className="space-y-1">
                <Label>Cook Time</Label>
                <TimeInput
                  value={formData.cookTime}
                  onChange={(minutes) => {
                    console.log('🍳 RecipeForm cookTime onChange - minutes:', minutes, 'type:', typeof minutes)
                    setFormData(prev => {
                      const newData = { ...prev, cookTime: minutes }
                      console.log('🍳 RecipeForm cookTime onChange - new formData:', newData)
                      return newData
                    })
                  }}
                  placeholder="00:00"
                />
                <p className="text-xs text-muted-foreground">
                  Enter hours and minutes (e.g., 1:30 for 1 hour 30 minutes)
                </p>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of the recipe"
                  rows={3}
                />
              </div>

              {/* Source URL */}
              <div className="space-y-1">
                <Label htmlFor="sourceUrl">Source URL</Label>
                <Input
                  id="sourceUrl"
                  type="text"
                  value={formData.sourceUrl}
                  onChange={(e) => {
                    let value = e.target.value
                    // Auto-add https:// if user types a domain without protocol
                    if (value && !value.match(/^https?:\/\//) && value.includes('.')) {
                      // Check if it looks like a domain (contains dots and no spaces)
                      if (value.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
                        value = 'https://' + value
                      }
                    }
                    setFormData(prev => ({ ...prev, sourceUrl: value }))
                  }}
                  placeholder="example.com/recipe or https://example.com/recipe"
                />
                {formData.sourceUrl && !formData.sourceUrl.match(/^https?:\/\/.+\..+/) && (
                  <p className="text-xs text-muted-foreground">
                    Tip: Add "https://" at the beginning for a complete URL
                  </p>
                )}
              </div>

              {/* Recipe Photo */}
              <div className="space-y-1">
                <Label>Recipe Photo</Label>
                <div
                  className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                    photoDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  }`}
                  onDragEnter={handlePhotoDrag}
                  onDragLeave={handlePhotoDrag}
                  onDragOver={handlePhotoDrag}
                  onDrop={handlePhotoDrop}
                >
                  {formData.photo ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2 min-w-0">
                        <img 
                          src={URL.createObjectURL(formData.photo)} 
                          alt="Recipe preview" 
                          className="w-16 h-16 object-cover rounded border"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate" title={formData.photo.name}>
                            {formData.photo.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {(formData.photo.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={removePhoto}
                          className="ml-auto"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          Drop a photo here or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Supports JPG, PNG, GIF, WebP, and other image formats
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => document.getElementById('photo-input')?.click()}
                      >
                        Browse Photos
                      </Button>
                    </div>
                  )}
                  <input
                    id="photo-input"
                    type="file"
                    className="hidden"
                    onChange={handlePhotoChange}
                    accept="image/*"
                  />
                </div>
              </div>

              <Separator />

              {/* File Upload */}
              <div className="space-y-1">
                <Label>Recipe File</Label>
                <div
                  className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                    dragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  {formData.file ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-center gap-2 min-w-0">
                        <Upload className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        <span className="font-medium truncate" title={formData.file.name}>{formData.file.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={removeFile}
                          className="ml-auto"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {(formData.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          Drop your recipe file here or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Supports documents, images, videos, audio, archives, and design files
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => document.getElementById('file-input')?.click()}
                      >
                        Browse Files
                      </Button>
                    </div>
                  )}
                  <input
                    id="file-input"
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept="*/*"
                  />
                </div>
              </div>

              <Separator />

              {/* Tags */}
              <div className="space-y-1">
                <Label>Tags</Label>
                <div className="space-y-2">
                  {/* Selected Tags */}
                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedTags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="default"
                          className="cursor-pointer text-sm px-3 py-1"
                          onClick={() => toggleTag(tag.id)}
                        >
                          {tag.name}
                          <X className="w-3 h-3 ml-1" />
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Available Tags */}
                  <div className="space-y-2 pt-2">
                    <Label>Add Tags</Label>
                    
                    {/* Tag Search Box */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        placeholder="Search tags..."
                        value={tagSearchTerm}
                        onChange={(e) => setTagSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    
                    {/* Filtered Tags - Limited display */}
                      <div className="flex flex-wrap gap-1">
                        {availableTags
                          .filter(tag => !formData.tagIds.includes(tag.id))
                          .filter(tag => 
                            tagSearchTerm === '' || 
                            tag.name.toLowerCase().includes(tagSearchTerm.toLowerCase())
                          )
                          .slice(0, 9) // Limit to 9 tags (3 rows x 3 tags per row)
                          .map((tag) => (
                            <Badge
                              key={tag.id}
                              variant="outline"
                              className="cursor-pointer hover:bg-muted text-sm px-3 py-1"
                              onClick={() => toggleTag(tag.id)}
                            >
                              {tag.name}
                            </Badge>
                          ))}
                      </div>
                      
                      {/* Show "more tags" message if there are additional tags */}
                      {availableTags
                        .filter(tag => !formData.tagIds.includes(tag.id))
                        .filter(tag => 
                          tagSearchTerm === '' || 
                          tag.name.toLowerCase().includes(tagSearchTerm.toLowerCase())
                        ).length > 9 && (
                        <div className="text-center py-1">
                          <p className="text-xs text-muted-foreground">
                            {tagSearchTerm === '' 
                              ? `+${availableTags.filter(tag => !formData.tagIds.includes(tag.id)).length - 9} more tags available`
                              : `+${availableTags.filter(tag => !formData.tagIds.includes(tag.id)).filter(tag => 
                                  tagSearchTerm !== '' && 
                                  tag.name.toLowerCase().includes(tagSearchTerm.toLowerCase())
                                ).length - 9} more matching tags`
                            }
                          </p>
                        </div>
                      )}
                      
                      {/* No results message */}
                      {availableTags
                        .filter(tag => !formData.tagIds.includes(tag.id))
                        .filter(tag => 
                          tagSearchTerm !== '' && 
                          tag.name.toLowerCase().includes(tagSearchTerm.toLowerCase())
                        ).length === 0 && tagSearchTerm !== '' && (
                        <div className="text-center py-2 space-y-2">
                          <p className="text-xs text-muted-foreground">
                            No tags found matching "{tagSearchTerm}"
                          </p>
                          {onCreateTag && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleCreateTag}
                              disabled={creatingTag}
                              className="text-xs"
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              {creatingTag ? 'Creating...' : `Create tag "${tagSearchTerm}"`}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                </div>
              </div>
            </div>
          </div>
        </form>

        <div className="flex justify-end gap-2 p-6 pt-4 border-t flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            disabled={loading || !formData.name.trim()}
            onClick={() => formRef.current?.requestSubmit()}
          >
            {loading ? 'Saving...' : initialData ? 'Update Recipe' : 'Add Recipe'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}