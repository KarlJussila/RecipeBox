'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Download, Upload, Database, FileText, AlertCircle, CheckCircle, Loader2, Trash2, X as XIcon } from 'lucide-react'
import { exportImportService, ImportResult } from '@/lib/export-import-service'
import { useToast } from '@/hooks/use-toast'

interface ExportImportDialogProps {
  onDataChanged?: () => void
  triggerClassName?: string
}

export function ExportImportDialog({ onDataChanged, triggerClassName }: ExportImportDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const { toast } = useToast()

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await exportImportService.downloadExport()
      toast({
        title: "Export Successful",
        description: "Your RecipeBox data has been exported successfully.",
      })
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export your data. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    setImportResult(null)

    try {
      const result = await exportImportService.importData(file)
      setImportResult(result)
      
      if (result.success) {
        toast({
          title: "Import Successful",
          description: result.message,
        })
        onDataChanged?.()
      } else {
        toast({
          title: "Import Completed with Issues",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Import Failed",
        description: "Failed to import data. Please check the file format.",
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
      // Reset file input
      event.target.value = ''
    }
  }

  const handleClearDatabase = async () => {
    setIsClearing(true)
    try {
      const result = await exportImportService.clearDatabase()
      
      if (result.success) {
        toast({
          title: "Database Cleared",
          description: "All recipes, tags, and files have been removed.",
        })
        onDataChanged?.()
        setShowClearConfirm(false)
        setIsOpen(false)
      } else {
        toast({
          title: "Clear Failed",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Clear Failed",
        description: "Failed to clear database. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={triggerClassName}>
          <Database className="h-4 w-4 mr-2" />
          Export/Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl p-0 flex flex-col" showCloseButton={false}>
        <DialogHeader className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle>Export & Import Data</DialogTitle>
              <DialogDescription className="mt-2">
                Export your complete RecipeBox database and files, or import from a previous export.
              </DialogDescription>
            </div>
            
            {/* Custom close button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-8 w-8 p-0 rounded-full hover:bg-muted"
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6 flex-1 overflow-auto">
          <div className="grid gap-6">
          {/* Export Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Export Data
              </CardTitle>
              <CardDescription>
                Download a complete backup of your recipes, tags, and files
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span>Includes: Recipes, Tags, Recipe Files, and Photos</span>
                </div>
                <Button 
                  onClick={handleExport} 
                  disabled={isExporting}
                  className="w-full"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Export All Data
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Import Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Import Data
              </CardTitle>
              <CardDescription>
                Restore data from a previous RecipeBox export
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  <span>This will add imported data to your existing recipes</span>
                </div>
                
                <div className="relative">
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImport}
                    disabled={isImporting}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                    style={{ pointerEvents: 'auto' }}
                  />
                  <Button 
                    variant="outline" 
                    className="w-full relative"
                    disabled={isImporting}
                    style={{ pointerEvents: 'none' }}
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Choose Import File
                      </>
                    )}
                  </Button>
                </div>

                {/* Import Results */}
                {importResult && (
                  <div className="mt-4 p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      {importResult.success ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-orange-500" />
                      )}
                      <span className="font-medium">
                        {importResult.success ? 'Import Successful' : 'Import Completed with Issues'}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 mb-3">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{importResult.importedRecipes}</div>
                        <div className="text-sm text-muted-foreground">Recipes</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{importResult.importedTags}</div>
                        <div className="text-sm text-muted-foreground">Tags</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{importResult.importedFiles}</div>
                        <div className="text-sm text-muted-foreground">Files</div>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mb-3">{importResult.message}</p>

                    {importResult.errors && importResult.errors.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-orange-600">Issues encountered:</div>
                        <div className="space-y-1">
                          {importResult.errors.map((error, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {error}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Clear Database Section */}
          <div className="flex items-center justify-between p-4 border border-red-200 rounded-lg bg-red-50 dark:bg-red-950/20 dark:border-red-800">
            <div className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-red-600" />
              <div>
                <div className="font-medium text-red-800 dark:text-red-200">Clear Database</div>
                <div className="text-sm text-red-600 dark:text-red-300">Permanently delete all data</div>
              </div>
            </div>
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              disabled={isClearing}
            >
              {isClearing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </>
              )}
            </Button>
          </div>
          </div>
        </div>

        {/* Clear Database Confirmation Dialog */}
        <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                Confirm Database Clear
              </DialogTitle>
              <DialogDescription>
                Are you absolutely sure you want to delete all recipes, tags, and files? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-4">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                  <div className="text-sm text-red-800 dark:text-red-200">
                    <p className="font-medium mb-2">This will permanently delete:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>All recipes and their data</li>
                      <li>All tags and tag relationships</li>
                      <li>All uploaded files and photos</li>
                    </ul>
                    <p className="mt-2 font-medium">Make sure you have exported your data if you want to keep it!</p>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearing}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleClearDatabase}
                disabled={isClearing}
              >
                {isClearing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Yes, Clear Everything
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
