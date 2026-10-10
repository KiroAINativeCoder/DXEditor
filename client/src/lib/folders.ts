// Folder management for DXEditor documents.
// Stores folder definitions and doc-to-folder assignments in localStorage.

export type Folder = {
  id: string
  name: string
  createdAt: string
  color?: string
}

const FOLDERS_KEY = 'dx_folders'
const DOC_FOLDERS_KEY = 'dx_doc_folders'
const FOLDER_COLLAPSED_KEY = 'dx_folder_collapsed'

export function getFolders(): Folder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFolders(folders: Folder[]): void {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
    window.dispatchEvent(new CustomEvent('dx:folders-updated'))
  } catch {
    // ignore quota/disabled storage
  }
}

export function createFolder(name: string): Folder {
  const trimmed = name.trim() || 'Untitled Folder'
  const newFolder: Folder = {
    id: 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    name: trimmed,
    createdAt: new Date().toISOString(),
  }
  const current = getFolders()
  saveFolders([...current, newFolder])
  return newFolder
}

export function renameFolder(folderId: string, newName: string): void {
  const trimmed = newName.trim()
  if (!trimmed) return
  const current = getFolders()
  const updated = current.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f))
  saveFolders(updated)
}

export function deleteFolder(folderId: string): void {
  const current = getFolders()
  const remaining = current.filter((f) => f.id !== folderId)
  saveFolders(remaining)

  // Remove doc mappings for this folder so docs return to Root/Unfiled
  const mapping = getDocFolders()
  let changed = false
  for (const docId of Object.keys(mapping)) {
    if (mapping[docId] === folderId) {
      delete mapping[docId]
      changed = true
    }
  }
  if (changed) {
    saveDocFolders(mapping)
  }
}

export function getDocFolders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DOC_FOLDERS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function saveDocFolders(mapping: Record<string, string>): void {
  try {
    localStorage.setItem(DOC_FOLDERS_KEY, JSON.stringify(mapping))
    window.dispatchEvent(new CustomEvent('dx:folders-updated'))
  } catch {
    // ignore quota
  }
}

export function getDocFolderId(docId: string): string | null {
  const mapping = getDocFolders()
  return mapping[docId] || null
}

export function moveDocToFolder(docId: string, folderId: string | null): void {
  const mapping = getDocFolders()
  if (!folderId) {
    if (mapping[docId]) {
      delete mapping[docId]
      saveDocFolders(mapping)
    }
  } else {
    mapping[docId] = folderId
    saveDocFolders(mapping)
  }
}

export function getCollapsedFolderIds(): string[] {
  try {
    const raw = localStorage.getItem(FOLDER_COLLAPSED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function setFolderCollapsed(folderId: string, collapsed: boolean): void {
  try {
    const current = new Set(getCollapsedFolderIds())
    if (collapsed) {
      current.add(folderId)
    } else {
      current.delete(folderId)
    }
    localStorage.setItem(FOLDER_COLLAPSED_KEY, JSON.stringify(Array.from(current)))
  } catch {
    // ignore
  }
}
