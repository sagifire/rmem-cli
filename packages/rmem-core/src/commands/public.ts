import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type {
    CheckResponse,
    CommandResult,
    EditDocumentRequest,
    FolderMoveRequest,
    FolderRemoveRequest,
    FolderResponse,
    FolderWriteRequest,
    ListResponse,
    ReadDocumentResponse,
    RmemConfig,
    RmemWarning,
    TreeGenerateResponse,
    TreeRepairResponse,
    WriteDocumentResponse
} from '../types.js'
import { commandError, isCommandError } from '../errors.js'
import { ensureBaseConfig, ensureConfig, loadBaseConfig, loadConfig } from '../config.js'
import { createDefaultFrontmatter, parseDocumentMarkdown, serializeDocument } from '../frontmatter.js'
import { documentIdFromPath } from '../ids.js'
import { normalizeLineEndings } from '../hash.js'
import { validateMarkdown } from '../markdown.js'
import { hasManagedHeaderMismatch, replaceManagedHeader } from '../managed-header.js'
import { atomicWriteUtf8, loadRegistry, readUtf8File, resolveMemoryPath, saveRegistry, toRegistryDocumentPath } from '../storage.js'
import { isVectorIndexCompatible, isVectorIndexFresh } from '../embeddings.js'
import { searchRegistry } from '../search.js'
import {
    areaDirectoryFromPath,
    areaKeyFromPath,
    areaReport,
    areasFromTree,
    generateTreeIndexFromFilesystem,
    loadTreeIndex,
    loadTreeIndexBackup,
    makeArea,
    normalizeAreaPath,
    parentKeyFromPath,
    saveTreeIndex,
    saveTreeIndexBackup,
    validateAreaPath,
    treeIndexPath
} from '../areas.js'
import {
    countOccurrences,
    firstParagraph,
    hashDocument,
    isNodeError,
    listMarkdownFiles,
    queryVectorBestEffort,
    reportFromFrontmatter,
    titleFromDocumentContent,
    tryReadExisting,
    updateRegistryAfterWrite
} from './internal.js'

export async function listCommand(root: string, pathInput?: string): Promise<CommandResult<ListResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const path = pathInput === undefined || pathInput.length === 0 ? [] : pathInput.split('/').filter(Boolean)
    const areaKey = path.length === 0 ? undefined : areaKeyFromPath(path)
    const items: ListResponse['items'] = []

    for (const [key, area] of Object.entries(config.areas)) {
        if (area.parent === areaKey || (areaKey === undefined && area.parent === undefined)) {
            const item: ListResponse['items'][number] = {
                type: 'area',
                key,
                title: area.title
            }
            if (area.description !== undefined) {
                item.description = area.description
            }
            items.push(item)
        }
    }

    for (const record of registry.documents.filter((record) => !record.archived)) {
        if (path.length === 0 || record.document.memoryPath.join('/') === path.join('/')) {
            items.push({
                type: 'document',
                key: record.path,
                title: record.document.title,
                document: record.document
            })
        }
    }

    const result: ListResponse = {
        ok: true,
        path,
        items
    }

    if (areaKey !== undefined) {
        const area = config.areas[areaKey]
        if (area !== undefined) {
            const areaReport = {
                key: areaKey,
                path,
                treeIndexPath: toRegistryDocumentPath(relative(root, treeIndexPath(root, config.memoryRoot))),
                title: area.title
            }
            if (area.description !== undefined) {
                result.area = {
                    ...areaReport,
                    description: area.description
                }
            } else {
                result.area = areaReport
            }
        }
    }

    return result
}

export async function readCommand(root: string, documentPath: string): Promise<CommandResult<ReadDocumentResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    try {
        const fullPath = resolveMemoryPath(root, config.memoryRoot, documentPath)
        const content = normalizeLineEndings(await readUtf8File(fullPath))
        const parsed = parseDocumentMarkdown(content)
        if (isCommandError(parsed)) {
            return parsed
        }

        return {
            ok: true,
            document: reportFromFrontmatter(toRegistryDocumentPath(documentPath), parsed.frontmatter),
            content,
            documentHash: hashDocument(parsed.frontmatter, parsed.body),
            warnings: hasManagedHeaderMismatch(parsed.body, parsed.frontmatter)
                ? [{ code: 'MANAGED_HEADER_MISMATCH', message: 'Managed header does not match frontmatter.' }]
                : []
        }
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return commandError({
                code: 'DOCUMENT_NOT_FOUND',
                message: `Document was not found: ${documentPath}`,
                suggestion: 'Use rmem list to find available documents.'
            })
        }

        return commandError({
            code: 'ENCODING_ERROR',
            message: 'Document could not be decoded as valid UTF-8.',
            details: String(error),
            suggestion: 'Fix file encoding without lossy transcoding.'
        })
    }
}

export async function writeCommand(root: string, documentPath: string, contentInput: string): Promise<CommandResult<WriteDocumentResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const folderError = validateDocumentFolder(config, documentPath)
    if (folderError !== undefined) {
        return folderError
    }

    const fullPath = resolveMemoryPath(root, config.memoryRoot, documentPath)
    const registryPath = toRegistryDocumentPath(documentPath)
    const now = new Date().toISOString()
    const normalizedInput = normalizeLineEndings(contentInput)
    const existing = await tryReadExisting(fullPath)
    const created = existing === undefined

    let content = normalizedInput
    if (!content.startsWith('---\n')) {
        const title = titleFromDocumentContent(content, documentPath)
        const defaultInput: Parameters<typeof createDefaultFrontmatter>[0] = {
            documentPath,
            title,
            documentId: documentIdFromPath(registryPath),
            now,
            memoryPath: documentMemoryPathFromPath(documentPath)
        }
        const summary = firstParagraph(content)
        if (summary !== undefined) {
            defaultInput.summary = summary
        }
        const frontmatter = createDefaultFrontmatter(defaultInput)
        content = serializeDocument(frontmatter, content)
    }

    const parsed = parseDocumentMarkdown(content)
    if (isCommandError(parsed)) {
        return parsed
    }

    const markdownError = validateMarkdown(parsed.body)
    if (markdownError !== undefined) {
        return markdownError
    }

    if (!created && existing !== undefined) {
        const existingParsed = parseDocumentMarkdown(existing)
        if (!isCommandError(existingParsed)) {
            parsed.frontmatter.rmem.createdAt = existingParsed.frontmatter.rmem.createdAt
            parsed.frontmatter.rmem.documentId = existingParsed.frontmatter.rmem.documentId
            parsed.frontmatter.rmem.revision = existingParsed.frontmatter.rmem.revision + 1
        }
    }

    parsed.frontmatter.rmem.updatedAt = now
    const body = replaceManagedHeader(parsed.body, parsed.frontmatter)
    const finalContent = serializeDocument(parsed.frontmatter, body)
    const finalParsed = parseDocumentMarkdown(finalContent)
    if (isCommandError(finalParsed)) {
        return finalParsed
    }

    const finalMarkdownError = validateMarkdown(finalParsed.body)
    if (finalMarkdownError !== undefined) {
        return finalMarkdownError
    }

    try {
        await atomicWriteUtf8(fullPath, finalContent)
        return await updateRegistryAfterWrite(root, config, registryPath, finalParsed.frontmatter, finalParsed.body, {
            created,
            changed: existing !== finalContent,
            staleOnly: false
        })
    } catch (error) {
        return commandError({
            code: 'WRITE_FAILED',
            message: 'Failed to atomically write document.',
            details: String(error),
            suggestion: 'Check file permissions and available disk space.'
        })
    }
}

export async function treeGenerateCommand(root: string): Promise<CommandResult<TreeGenerateResponse>> {
    const config = await ensureBaseConfig(root)
    const existing = await loadTreeIndex(root, config.memoryRoot)
    if (!isCommandError(existing)) {
        return commandError({
            code: 'MEMORY_FOLDER_ALREADY_EXISTS',
            message: 'memory/tree-index.md already exists.',
            suggestion: 'Edit memory/tree-index.md directly or use folder commands.'
        })
    }

    const tree = await generateTreeIndexFromFilesystem(root, config.memoryRoot)
    return {
        ok: true,
        created: true,
        treeIndexPath: tree.treeIndexPath,
        folders: tree.folders.map((record) => areaReport(root, config.memoryRoot, record.path, record.area)),
        warnings: [
            {
                code: 'MEMORY_FOLDER_DESCRIPTION_EMPTY',
                message: 'Generated tree-index.md contains empty folder descriptions.',
                details: { count: tree.folders.length }
            }
        ]
    }
}

export async function treeRepairCommand(root: string): Promise<CommandResult<TreeRepairResponse>> {
    const config = await ensureBaseConfig(root)
    const backup = await loadTreeIndexBackup(root)
    if (isCommandError(backup)) {
        return backup
    }

    const tree = await saveTreeIndex(root, config.memoryRoot, backup.folders)
    return {
        ok: true,
        repaired: true,
        treeIndexPath: tree.treeIndexPath,
        folders: tree.folders.map((record) => areaReport(root, config.memoryRoot, record.path, record.area)),
        warnings: []
    }
}

export async function createFolderCommand(root: string, pathInput: string, request: FolderWriteRequest): Promise<CommandResult<FolderResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const tree = await loadTreeIndex(root, config.memoryRoot)
    if (isCommandError(tree)) {
        return tree
    }

    const path = normalizeAreaPath(pathInput)
    const pathError = validateAreaPath(path)
    if (pathError !== undefined) {
        return commandError({
            code: 'INVALID_MEMORY_PATH',
            message: pathError,
            suggestion: 'Use a memory folder path such as project/architecture.'
        })
    }

    const key = areaKeyFromPath(path)
    if (config.areas[key] !== undefined) {
        return commandError({
            code: 'MEMORY_FOLDER_ALREADY_EXISTS',
            message: 'Memory folder already exists.',
            details: { path },
            suggestion: 'Use rmem folder update to change its description.'
        })
    }

    const parent = parentKeyFromPath(path)
    if (parent !== undefined && config.areas[parent] === undefined) {
        return commandError({
            code: 'MEMORY_FOLDER_NOT_FOUND',
            message: 'Parent memory folder does not exist.',
            details: { path, parent },
            suggestion: `Create parent folder first: rmem folder create ${path.slice(0, -1).join('/')} --description "..."`
        })
    }

    const area = makeArea(path, request.description, request.title)
    tree.folders.push({ path, key, area })
    const updatedTree = await saveTreeIndex(root, config.memoryRoot, tree.folders)
    const folder = areaReport(root, config.memoryRoot, path, area)
    await saveTreeIndexBackup(root, updatedTree)

    return emptyFolderResponse(folder, {
        created: true,
        changed: true
    })
}

export async function updateFolderCommand(root: string, pathInput: string, request: FolderWriteRequest): Promise<CommandResult<FolderResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }
    const tree = await loadTreeIndex(root, config.memoryRoot)
    if (isCommandError(tree)) {
        return tree
    }

    const path = normalizeAreaPath(pathInput)
    const area = readAreaByPath(config, path)
    if (isCommandError(area)) {
        return area
    }

    const updated = makeArea(path, request.description, request.title ?? area.title)
    const key = areaKeyFromPath(path)
    tree.folders = tree.folders.map((record) => record.key === key ? { path, key, area: updated } : record)
    const updatedTree = await saveTreeIndex(root, config.memoryRoot, tree.folders)
    const folder = areaReport(root, config.memoryRoot, path, updated)
    await saveTreeIndexBackup(root, updatedTree)

    return emptyFolderResponse(folder, {
        changed: true
    })
}

export async function moveFolderCommand(root: string, fromInput: string, toInput: string, request: FolderMoveRequest = {}): Promise<CommandResult<FolderResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }
    const tree = await loadTreeIndex(root, config.memoryRoot)
    if (isCommandError(tree)) {
        return tree
    }

    const fromPath = normalizeAreaPath(fromInput)
    const toPath = normalizeAreaPath(toInput)
    const source = readAreaByPath(config, fromPath)
    if (isCommandError(source)) {
        return source
    }

    const pathError = validateAreaPath(toPath)
    if (pathError !== undefined) {
        return commandError({
            code: 'INVALID_MEMORY_PATH',
            message: pathError,
            suggestion: 'Use a memory folder path such as project/architecture.'
        })
    }

    const fromKey = areaKeyFromPath(fromPath)
    const toKey = areaKeyFromPath(toPath)
    if (fromKey !== toKey && config.areas[toKey] !== undefined) {
        return commandError({
            code: 'MEMORY_FOLDER_ALREADY_EXISTS',
            message: 'Target memory folder already exists.',
            details: { from: fromPath, to: toPath }
        })
    }

    const toParent = parentKeyFromPath(toPath)
    if (toParent !== undefined && toParent !== fromKey && config.areas[toParent] === undefined) {
        return commandError({
            code: 'MEMORY_FOLDER_NOT_FOUND',
            message: 'Target parent memory folder does not exist.',
            details: { to: toPath, parent: toParent }
        })
    }

    const fromDirectory = areaDirectoryFromPath(root, config.memoryRoot, fromPath)
    const toDirectory = areaDirectoryFromPath(root, config.memoryRoot, toPath)
    if (fromDirectory !== toDirectory) {
        await rename(fromDirectory, toDirectory)
    }

    const movedArea = makeArea(toPath, request.description ?? source.description ?? '', request.title ?? source.title)
    const movedRecords = tree.folders.map((record) => {
        if (!memoryPathStartsWith(record.path, fromPath)) {
            return record
        }

        const suffix = record.path.slice(fromPath.length)
        const nextPath = [...toPath, ...suffix]
        const nextKey = areaKeyFromPath(nextPath)
        const nextArea = record.key === fromKey
            ? movedArea
            : makeArea(nextPath, record.area.description ?? '', record.area.title)
        return {
            path: nextPath,
            key: nextKey,
            area: nextArea
        }
    })
    await saveTreeIndex(root, config.memoryRoot, movedRecords)
    const folder = areaReport(root, config.memoryRoot, toPath, movedArea)

    const movedConfig: RmemConfig = {
        ...config,
        areas: areasFromTree({
            schemaVersion: 1,
            treeIndexPath: tree.treeIndexPath,
            folders: movedRecords
        })
    }
    const affected = await rewriteDocumentsForMovedFolder(root, movedConfig, fromPath, toPath)
    return {
        ok: true,
        folder,
        changed: true,
        moved: true,
        affected,
        warnings: []
    }
}

export async function removeFolderCommand(root: string, pathInput: string, request: FolderRemoveRequest = {}): Promise<CommandResult<FolderResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }
    const tree = await loadTreeIndex(root, config.memoryRoot)
    if (isCommandError(tree)) {
        return tree
    }

    const path = normalizeAreaPath(pathInput)
    const area = readAreaByPath(config, path)
    if (isCommandError(area)) {
        return area
    }

    if (path.length === 1 && areaKeyFromPath(path) === 'project') {
        return commandError({
            code: 'MEMORY_FOLDER_PROTECTED',
            message: 'The root project memory folder cannot be removed.',
            suggestion: 'Remove child folders instead.'
        })
    }

    const directory = areaDirectoryFromPath(root, config.memoryRoot, path)
    if (request.deleteFiles === true) {
        await rm(directory, { recursive: true, force: true })
    }

    const remaining = tree.folders.filter((record) => !memoryPathStartsWith(record.path, path))
    await saveTreeIndex(root, config.memoryRoot, remaining)
    const affected = request.deleteFiles === true
        ? await cleanupRegistryForRemovedFolder(root, path)
        : await archiveRegistryForRemovedFolder(root, config, path)

    return {
        ok: true,
        folder: areaReport(root, config.memoryRoot, path, area),
        changed: true,
        removed: true,
        affected,
        warnings: []
    }
}

function validateDocumentFolder(config: RmemConfig, documentPath: string): ReturnType<typeof commandError> | undefined {
    const folderUnits = toRegistryDocumentPath(dirname(documentPath))
        .split('/')
        .filter((unit) => unit.length > 0 && unit !== '.')
    if (folderUnits.length === 0) {
        return undefined
    }

    const memoryPath = ['project', ...folderUnits]
    const key = areaKeyFromPath(memoryPath)
    if (config.areas[key] !== undefined) {
        return undefined
    }

    return commandError({
        code: 'MEMORY_FOLDER_NOT_FOUND',
        message: 'Document target folder is not defined in memory/tree-index.md.',
        details: { documentPath, memoryPath: key },
        suggestion: `Create the folder first: rmem folder create project/${folderUnits.join('/')} --description "..."`
    })
}

function documentMemoryPathFromPath(documentPath: string): string[] {
    const folderUnits = toRegistryDocumentPath(dirname(documentPath))
        .split('/')
        .filter((unit) => unit.length > 0 && unit !== '.')

    return folderUnits.length === 0 ? ['project'] : ['project', ...folderUnits]
}

function readAreaByPath(config: RmemConfig, path: string[]): CommandResult<RmemConfig['areas'][string]> {
    const pathError = validateAreaPath(path)
    if (pathError !== undefined) {
        return commandError({
            code: 'INVALID_MEMORY_PATH',
            message: pathError,
            suggestion: 'Use a memory folder path such as project/architecture.'
        })
    }

    const area = config.areas[areaKeyFromPath(path)]
    if (area === undefined) {
        return commandError({
            code: 'MEMORY_FOLDER_NOT_FOUND',
            message: 'Memory folder does not exist.',
            details: { path },
            suggestion: `Create it first: rmem folder create ${path.join('/')} --description "..."`
        })
    }

    return area
}

function emptyFolderResponse(folder: FolderResponse['folder'], flags: { created?: boolean, changed?: boolean }): FolderResponse {
    const response: FolderResponse = {
        ok: true,
        folder,
        affected: {
            documents: 0,
            staleNotes: 0,
            removedNotes: 0,
            embeddingsRemoved: 0
        },
        warnings: []
    }

    if (flags.created !== undefined) {
        response.created = flags.created
    }
    if (flags.changed !== undefined) {
        response.changed = flags.changed
    }

    return response
}

async function rewriteDocumentsForMovedFolder(root: string, config: RmemConfig, fromPath: string[], toPath: string[]): Promise<FolderResponse['affected']> {
    const registry = await loadRegistry(root)
    const oldPrefix = documentPathPrefix(fromPath)
    const newPrefix = documentPathPrefix(toPath)
    const affectedRecords = registry.documents.filter((record) => pathIsInside(record.path, oldPrefix))
    let staleNotes = 0

    for (const record of affectedRecords) {
        const nextPath = replacePathPrefix(record.path, oldPrefix, newPrefix)
        const fullPath = resolveMemoryPath(root, config.memoryRoot, nextPath)
        const parsed = parseDocumentMarkdown(await readUtf8File(fullPath))
        if (isCommandError(parsed)) {
            continue
        }

        if (samePath(parsed.frontmatter.rmem.memoryPath, fromPath)) {
            parsed.frontmatter.rmem.memoryPath = toPath
            parsed.frontmatter.rmem.revision += 1
            parsed.frontmatter.rmem.updatedAt = new Date().toISOString()
        }

        const body = replaceManagedHeader(parsed.body, parsed.frontmatter)
        const finalContent = serializeDocument(parsed.frontmatter, body)
        await atomicWriteUtf8(fullPath, finalContent)
        const updated = await updateRegistryAfterWrite(root, config, nextPath, parsed.frontmatter, body, {
            created: false,
            changed: true,
            staleOnly: false
        })
        staleNotes += updated.affected.staleNotes
    }

    const updatedRegistry = await loadRegistry(root)
    updatedRegistry.documents = updatedRegistry.documents.filter((record) => !affectedRecords.some((affected) => affected.path === record.path))
    updatedRegistry.notes = updatedRegistry.notes.filter((note) => !pathIsInside(note.source.documentPath, oldPrefix))
    updatedRegistry.places = updatedRegistry.places.filter((place) => !pathIsInside(place.documentPath, oldPrefix))
    const embeddingsBefore = updatedRegistry.embeddings?.vectors.length ?? 0
    if (updatedRegistry.embeddings !== undefined) {
        const noteIds = new Set(updatedRegistry.notes.map((note) => note.id))
        updatedRegistry.embeddings.vectors = updatedRegistry.embeddings.vectors.filter((vector) => noteIds.has(vector.noteId))
    }
    const embeddingsAfter = updatedRegistry.embeddings?.vectors.length ?? 0
    await saveRegistry(root, updatedRegistry)

    return {
        documents: affectedRecords.length,
        staleNotes,
        removedNotes: 0,
        embeddingsRemoved: embeddingsBefore - embeddingsAfter
    }
}

async function cleanupRegistryForRemovedFolder(root: string, path: string[]): Promise<FolderResponse['affected']> {
    const registry = await loadRegistry(root)
    const prefix = documentPathPrefix(path)
    const documentsBefore = registry.documents.length
    const notesBefore = registry.notes.length
    const embeddingsBefore = registry.embeddings?.vectors.length ?? 0

    registry.documents = registry.documents.filter((record) => !pathIsInside(record.path, prefix) && !memoryPathStartsWith(record.document.memoryPath, path))
    registry.notes = registry.notes.filter((note) => !pathIsInside(note.source.documentPath, prefix))
    registry.places = registry.places.filter((place) => !pathIsInside(place.documentPath, prefix))

    if (registry.embeddings !== undefined) {
        const noteIds = new Set(registry.notes.map((note) => note.id))
        registry.embeddings.vectors = registry.embeddings.vectors.filter((vector) => noteIds.has(vector.noteId))
    }

    const embeddingsAfter = registry.embeddings?.vectors.length ?? 0
    await saveRegistry(root, registry)

    return {
        documents: documentsBefore - registry.documents.length,
        staleNotes: 0,
        removedNotes: notesBefore - registry.notes.length,
        embeddingsRemoved: embeddingsBefore - embeddingsAfter
    }
}

async function archiveRegistryForRemovedFolder(root: string, config: RmemConfig, path: string[]): Promise<FolderResponse['affected']> {
    const registry = await loadRegistry(root)
    const prefix = documentPathPrefix(path)
    const affectedRecords = registry.documents.filter((record) => !record.archived && (pathIsInside(record.path, prefix) || memoryPathStartsWith(record.document.memoryPath, path)))
    const notesBefore = registry.notes.length
    const embeddingsBefore = registry.embeddings?.vectors.length ?? 0

    for (const record of affectedRecords) {
        const fullPath = resolveMemoryPath(root, config.memoryRoot, record.path)
        const archivePath = join(root, '.rmem', 'archive', record.path)
        try {
            const parsed = parseDocumentMarkdown(await readUtf8File(fullPath))
            if (!isCommandError(parsed)) {
                parsed.frontmatter.rmem.status = 'archived'
                parsed.frontmatter.rmem.updatedAt = new Date().toISOString()
                parsed.frontmatter.rmem.revision += 1
                const archivedBody = replaceManagedHeader(parsed.body, parsed.frontmatter)
                await atomicWriteUtf8(archivePath, serializeDocument(parsed.frontmatter, archivedBody))
            }
            await rm(fullPath, { force: true })
        } catch {
            await mkdir(dirname(archivePath), { recursive: true })
        }
        record.archived = true
        record.document.status = 'archived'
    }

    registry.notes = registry.notes.map((note) => {
        if (pathIsInside(note.source.documentPath, prefix)) {
            return { ...note, status: 'archived' }
        }

        return note
    })

    if (registry.embeddings !== undefined) {
        const activeNoteIds = new Set(registry.notes.filter((note) => note.status === 'active').map((note) => note.id))
        registry.embeddings.vectors = registry.embeddings.vectors.filter((vector) => activeNoteIds.has(vector.noteId))
    }

    const embeddingsAfter = registry.embeddings?.vectors.length ?? 0
    await saveRegistry(root, registry)

    return {
        documents: affectedRecords.length,
        staleNotes: 0,
        removedNotes: notesBefore - registry.notes.length,
        embeddingsRemoved: embeddingsBefore - embeddingsAfter
    }
}

function documentPathPrefix(path: string[]): string {
    const physicalUnits = path[0] === 'project' ? path.slice(1) : path
    return physicalUnits.join('/')
}

function pathIsInside(path: string, prefix: string): boolean {
    if (prefix.length === 0) {
        return true
    }

    return path === prefix || path.startsWith(`${prefix}/`)
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
    if (path === oldPrefix) {
        return newPrefix
    }

    return `${newPrefix}/${path.slice(oldPrefix.length + 1)}`
}

function samePath(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((unit, index) => unit === right[index])
}

function memoryPathStartsWith(path: string[], prefix: string[]): boolean {
    return prefix.every((unit, index) => path[index] === unit)
}

export async function editCommand(root: string, documentPath: string, request: EditDocumentRequest): Promise<CommandResult<WriteDocumentResponse>> {
    if (!Array.isArray(request.edits) || request.edits.length === 0) {
        return commandError({
            code: 'INVALID_EDIT_REQUEST',
            message: 'Edit request must contain at least one edit.',
            suggestion: 'Pass JSON with edits containing oldText and newText.'
        })
    }

    const read = await readCommand(root, documentPath)
    if (isCommandError(read)) {
        return read
    }

    if (request.documentHash !== undefined && request.documentHash !== read.documentHash) {
        return commandError({
            code: 'DOCUMENT_HASH_MISMATCH',
            message: 'Provided documentHash does not match current document content.',
            suggestion: 'Run rmem read again and retry with the latest documentHash.'
        })
    }

    let content = read.content
    for (const edit of request.edits) {
        const matches = countOccurrences(content, edit.oldText)
        if (matches === 0) {
            return commandError({
                code: 'OLD_TEXT_NOT_FOUND',
                message: 'oldText was not found in the current document.',
                details: { oldText: edit.oldText },
                suggestion: 'Use exact text from rmem read output.'
            })
        }

        if (matches > 1) {
            return commandError({
                code: 'OLD_TEXT_AMBIGUOUS',
                message: 'oldText matched more than once.',
                details: { oldText: edit.oldText, matches },
                suggestion: 'Use a larger exact text span.'
            })
        }

        content = content.replace(edit.oldText, edit.newText)
    }

    return writeCommand(root, documentPath, content)
}

export async function removeCommand(root: string, documentPath: string): Promise<CommandResult<WriteDocumentResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const read = await readCommand(root, documentPath)
    if (isCommandError(read)) {
        return read
    }

    const registry = await loadRegistry(root)
    const registryPath = toRegistryDocumentPath(documentPath)
    const record = registry.documents.find((candidate) => candidate.path === registryPath)
    const archivePath = join(root, '.rmem', 'archive', registryPath)

    try {
        await mkdir(dirname(archivePath), { recursive: true })
        const parsed = parseDocumentMarkdown(read.content)
        if (isCommandError(parsed)) {
            return parsed
        }

        parsed.frontmatter.rmem.status = 'archived'
        parsed.frontmatter.rmem.updatedAt = new Date().toISOString()
        parsed.frontmatter.rmem.revision += 1
        const archivedBody = replaceManagedHeader(parsed.body, parsed.frontmatter)
        const archivedContent = serializeDocument(parsed.frontmatter, archivedBody)
        await atomicWriteUtf8(archivePath, archivedContent)
        await atomicWriteUtf8(resolveMemoryPath(root, config.memoryRoot, documentPath), archivedContent)

        if (record !== undefined) {
            record.archived = true
            record.document.status = 'archived'
        }

        registry.notes = registry.notes.map((note) => {
            if (note.source.documentPath === registryPath) {
                return { ...note, status: 'archived' }
            }

            return note
        })

        await saveRegistry(root, registry)

        return {
            ok: true,
            document: {
                ...read.document,
                status: 'archived',
                revision: parsed.frontmatter.rmem.revision
            },
            created: false,
            changed: true,
            documentHash: read.documentHash,
            affected: {
                staleNotes: 0,
                rebuiltNotes: 0,
                structuralPlaces: 0
            },
            warnings: []
        }
    } catch (error) {
        return commandError({
            code: 'WRITE_FAILED',
            message: 'Failed to archive document.',
            details: String(error),
            suggestion: 'Check file permissions and archive directory.'
        })
    }
}

export async function checkCommand(root: string): Promise<CommandResult<CheckResponse>> {
    const baseConfig = await loadBaseConfig(root)
    if (isCommandError(baseConfig)) {
        return baseConfig
    }

    const tree = await loadTreeIndex(root, baseConfig.memoryRoot)
    const treeIssues: RmemWarning[] = []
    const config: RmemConfig = !isCommandError(tree)
        ? { ...baseConfig, areas: areasFromTree(tree) }
        : baseConfig
    if (isCommandError(tree)) {
        treeIssues.push({
            code: tree.code,
            message: tree.message,
            details: tree.details
        })
    } else {
        await saveTreeIndexBackup(root, tree)
        for (const record of tree.folders) {
            if ((record.area.description ?? '').trim().length === 0) {
                treeIssues.push({
                    code: 'MEMORY_FOLDER_DESCRIPTION_EMPTY',
                    message: 'Memory folder description is empty.',
                    details: { path: record.key }
                })
            }
        }
    }

    const configCheck = await loadConfig(root)
    if (isCommandError(configCheck) && !treeIssues.some((issue) => issue.code === configCheck.code)) {
        treeIssues.push({
            code: configCheck.code,
            message: configCheck.message,
            details: configCheck.details
        })
    }

    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const issues: RmemWarning[] = [...treeIssues]
    const documentIds = new Set<string>()

    const memoryRootPath = join(root, config.memoryRoot)
    for await (const documentPath of listMarkdownFiles(memoryRootPath)) {
        const registryPath = toRegistryDocumentPath(relative(memoryRootPath, documentPath))
        if (registryPath === 'tree-index.md') {
            continue
        }
        try {
            const content = normalizeLineEndings(await readUtf8File(documentPath))
            const parsed = parseDocumentMarkdown(content)
            if (isCommandError(parsed)) {
                issues.push({ code: parsed.code, message: parsed.message, details: { path: registryPath } })
                continue
            }

            const markdownError = validateMarkdown(parsed.body)
            if (markdownError !== undefined) {
                issues.push({ code: markdownError.code, message: markdownError.message, details: { path: registryPath } })
                continue
            }

            if (documentIds.has(parsed.frontmatter.rmem.documentId)) {
                issues.push({
                    code: 'DUPLICATE_DOCUMENT_ID',
                    message: 'Duplicate documentId found.',
                    details: { path: registryPath, documentId: parsed.frontmatter.rmem.documentId }
                })
            }
            documentIds.add(parsed.frontmatter.rmem.documentId)

            if (hasManagedHeaderMismatch(parsed.body, parsed.frontmatter)) {
                issues.push({
                    code: 'MANAGED_HEADER_MISMATCH',
                    message: 'Managed header does not match frontmatter.',
                    details: { path: registryPath }
                })
            }

            const memoryPathKey = areaKeyFromPath(parsed.frontmatter.rmem.memoryPath)
            if (config.areas[memoryPathKey] === undefined) {
                issues.push({
                    code: 'MEMORY_FOLDER_NOT_FOUND',
                    message: 'Document references unknown memory folder.',
                    details: { path: registryPath, memoryPath: memoryPathKey }
                })
            }

            const registryRecord = registry.documents.find((record) => record.path === registryPath)
            if (registryRecord === undefined) {
                issues.push({
                    code: 'STALE_INDEX',
                    message: 'Document is missing from registry.',
                    details: { path: registryPath }
                })
            } else {
                const currentHash = hashDocument(parsed.frontmatter, parsed.body)
                if (registryRecord.documentHash !== currentHash) {
                    issues.push({
                        code: 'STALE_INDEX',
                        message: 'Registry document hash does not match file content.',
                        details: { path: registryPath }
                    })
                }
            }
        } catch (error) {
            issues.push({
                code: 'ENCODING_ERROR',
                message: 'File is not valid UTF-8.',
                details: { path: registryPath, error: String(error) }
            })
        }
    }

    for (const note of registry.notes) {
        const document = registry.documents.find((record) => record.document.documentId === note.source.documentId && !record.archived)
        if (document === undefined && note.status !== 'archived') {
            issues.push({
                code: 'BROKEN_LINK',
                message: 'Note references a missing or archived document.',
                details: { noteId: note.id, documentId: note.source.documentId }
            })
        }

        if (note.status === 'stale') {
            issues.push({
                code: 'STALE_INDEX',
                message: 'Stale note found.',
                details: { noteId: note.id }
            })
        }

        const place = registry.places.find((candidate) => candidate.id === note.source.structuralPlaceId)
        if (place === undefined && note.status !== 'archived') {
            issues.push({
                code: 'BROKEN_LINK',
                message: 'Note references a missing structural place.',
                details: { noteId: note.id, structuralPlaceId: note.source.structuralPlaceId }
            })
        }

        if (place !== undefined && place.sourceHash !== note.source.sourceHash && note.status === 'active') {
            issues.push({
                code: 'STALE_INDEX',
                message: 'Active note source hash no longer matches structural place.',
                details: { noteId: note.id, structuralPlaceId: note.source.structuralPlaceId }
            })
        }
    }

    for (const place of registry.places) {
        const document = registry.documents.find((record) => record.document.documentId === place.documentId)
        if (document === undefined) {
            issues.push({
                code: 'BROKEN_LINK',
                message: 'Structural place references a missing document.',
                details: { placeId: place.id, documentId: place.documentId }
            })
        }
    }

    const activeNotes = registry.notes.filter((note) => note.status === 'active')
    if (activeNotes.length > 0 && !isVectorIndexFresh(registry.embeddings, registry.notes)) {
        issues.push({
            code: 'STALE_INDEX',
            message: 'Vector index is missing or stale.',
            details: { indexedNotes: registry.embeddings?.vectors.length ?? 0 }
        })
    } else if (activeNotes.length > 0 && registry.embeddings !== undefined && config.providers?.embeddings !== undefined && !isVectorIndexCompatible(registry.embeddings, config.providers.embeddings.type, config.providers.embeddings.model)) {
        issues.push({
            code: 'STALE_INDEX',
            message: 'Vector index provider or model does not match current config.',
            details: {
                indexProvider: registry.embeddings.provider,
                indexModel: registry.embeddings.model,
                configProvider: config.providers.embeddings.type,
                configModel: config.providers.embeddings.model
            }
        })
    }

    return {
        ok: true,
        valid: issues.length === 0,
        issues
    }
}

export async function searchCommand(root: string, query: string): Promise<CommandResult<Awaited<ReturnType<typeof searchRegistry>>>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const queryEmbedding = await queryVectorBestEffort(config, query)
    return searchRegistry({
        query,
        registry,
        config,
        queryVector: queryEmbedding.vector,
        queryVectorProvider: queryEmbedding.provider,
        queryVectorModel: queryEmbedding.model,
        warnings: queryEmbedding.warnings
    })
}
