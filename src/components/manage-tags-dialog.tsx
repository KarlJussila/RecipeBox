'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Search, Tag as TagIcon, Check, X as XIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
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
import { toast } from 'sonner'
import { dataService } from '@/lib/simple-data-service'

interface Tag {
  id: string
  name: string
}

interface ManageTagsDialogProps {
  children: React.ReactNode
  onTagsChange?: () => void
}

export default function ManageTagsDialog({ children, onTagsChange }: ManageTagsDialogProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [newTagName, setNewTagName] = useState('')
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showError, setShowError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (open) {
      fetchTags()
    }
  }, [open])

  const fetchTags = async () => {
    try {
      const data = await dataService.getTags()
      setTags(data)
    } catch (error) {
      console.error('Failed to fetch tags:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTagName.trim()) return

    // Check for duplicate tag names (case-insensitive)
    const trimmedName = newTagName.trim()
    const existingTag = tags.find(tag => 
      tag.name.toLowerCase() === trimmedName.toLowerCase()
    )
    
    if (existingTag) {
      setShowError(true)
      setErrorMessage(`A tag named "${existingTag.name}" already exists`)
      toast.error(`A tag named "${existingTag.name}" already exists`)
      
      // Reset error state after 4 seconds
      setTimeout(() => {
        setShowError(false)
        setErrorMessage('')
      }, 4000)
      return
    }

    setIsCreating(true)
    
    try {
      const newTag = await dataService.createTag(trimmedName)
      setTags(prev => [newTag, ...prev])
      setNewTagName('')
      onTagsChange?.()
      
      // Show success feedback
      setShowSuccess(true)
      toast.success(`Tag "${newTag.name}" created successfully!`)
      
      // Reset success state after 2 seconds
      setTimeout(() => setShowSuccess(false), 2000)
    } catch (error) {
      console.error('Error creating tag:', error)
      toast.error('Failed to create tag')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteTag = async (tagId: string) => {
    try {
      await dataService.deleteTag(tagId)
      setTags(prev => prev.filter(tag => tag.id !== tagId))
      onTagsChange?.()
    } catch (error) {
      console.error('Error deleting tag:', error)
      alert('Failed to delete tag')
    }
  }

  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0" showCloseButton={false}>
        <DialogHeader className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <TagIcon className="w-5 h-5" />
                Manage Tags
              </DialogTitle>
              <DialogDescription className="mt-2">
                Create new tags or delete existing ones. Deleting a tag will remove it from all recipes.
              </DialogDescription>
            </div>
            
            {/* Custom close button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-8 w-8 p-0 rounded-full hover:bg-muted"
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6 flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Create new tag section */}
          <div className="flex-shrink-0">
            <form onSubmit={handleCreateTag} className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  placeholder="Enter new tag name..."
                  value={newTagName}
                  onChange={(e) => {
                    setNewTagName(e.target.value)
                    // Clear error state when user starts typing
                    if (showError) {
                      setShowError(false)
                      setErrorMessage('')
                    }
                  }}
                  className={
                    showSuccess 
                      ? 'pr-10 border-green-500 focus:border-green-500' 
                      : showError 
                        ? 'pr-10 border-red-500 focus:border-red-500' 
                        : ''
                  }
                  disabled={isCreating}
                />
                {showSuccess && (
                  <Check className="absolute right-3 top-1/2 transform -translate-y-1/2 text-green-500 w-4 h-4" />
                )}

              </div>
              <Button 
                type="submit" 
                disabled={!newTagName.trim() || isCreating}
                className={showSuccess ? 'bg-green-500 hover:bg-green-600' : ''}
              >
                {isCreating ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                ) : showSuccess ? (
                  <Check className="w-4 h-4 mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                {isCreating ? 'Creating...' : showSuccess ? 'Created!' : 'Add'}
              </Button>
            </form>
            {showError && (
              <div className="mt-2 text-sm text-red-500">
                {errorMessage}
              </div>
            )}
          </div>

          <Separator className="my-4 flex-shrink-0" />

          {/* Search and tag list */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-shrink-0">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search tags..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                      <p className="mt-2 text-sm text-muted-foreground">Loading tags...</p>
                    </div>
                  </div>
                ) : filteredTags.length === 0 ? (
                  <div className="text-center py-8">
                    <TagIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {searchTerm ? 'No tags found matching your search.' : 'No tags yet. Create your first tag above!'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 pr-4">
                    {filteredTags.map((tag) => (
                      <div
                        key={tag.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <Badge variant="outline" className="px-3 py-1.5 rounded-full">
                          {tag.name}
                        </Badge>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Tag</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete the tag "{tag.name}"? This will remove it from all recipes that use it, and this action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteTag(tag.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}