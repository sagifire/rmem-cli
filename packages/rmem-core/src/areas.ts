import { readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { MemoryAreaConfig, MemoryAreaReport, RmemCommandError, RmemConfig } from './types.js'
import { commandError } from './errors.js'
import { atomicWriteUtf8, readUtf8File, resolveMemoryPath, toRegistryDocumentPath } from './storage.js'

export const treeIndexFileName = 'tree-index.md'
export const treeIndexBackupPath = '.rmem/index/tree-index.json'
const treeIndexStart = '<!-- rmem:tree-index start -->'
const treeIndexEnd = '<!-- rmem:tree-index end -->'

export type TreeIndexRecord = {
    path: string[]
    key: string
    area: MemoryAreaConfig
}

export type TreeIndexState = {
    schemaVersion: number
    treeIndexPath: string
    folders: TreeIndexRecord[]
}

export function normalizeAreaPath(input: string): string[] {
    return input
        .split('/')
        .map((unit) => unit.trim())
        .filter((unit) => unit.length > 0)
}

export function validateAreaPath(path: string[]): string | undefined {
    if (path.length === 0) {
        return 'Memory folder path must not be empty.'
    }

    if (path[0] !== 'project') {
        return 'Memory folder path must start with project.'
    }

    for (const unit of path) {
        if (unit === '.' || unit === '..' || unit.includes('\\') || unit.includes('/')) {
            return `Invalid memory folder path unit: ${unit}`
        }
    }

    return undefined
}

export function areaKeyFromPath(path: string[]): string {
    return path.join('/')
}

export function parentKeyFromPath(path: string[]): string | undefined {
    return path.length > 1 ? path.slice(0, -1).join('/') : undefined
}

export function titleFromAreaKey(key: string): string {
    const segment = key.split('/').at(-1) ?? key
    return segment
        .split(/[-_]+/u)
        .filter((part) => part.length > 0)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ')
}

export function areaDirectoryFromPath(root: string, memoryRoot: string, path: string[]): string {
    const physicalUnits = path[0] === 'project' ? path.slice(1) : path
    return physicalUnits.length === 0
        ? resolveMemoryPath(root, memoryRoot, '.')
        : resolveMemoryPath(root, memoryRoot, physicalUnits.join('/'))
}

export function treeIndexPath(root: string, memoryRoot: string): string {
    return resolveMemoryPath(root, memoryRoot, treeIndexFileName)
}

export function areaReport(root: string, memoryRoot: string, path: string[], area: MemoryAreaConfig): MemoryAreaReport {
    const result: MemoryAreaReport = {
        key: areaKeyFromPath(path),
        path,
        title: area.title,
        treeIndexPath: toRegistryDocumentPath(relative(root, treeIndexPath(root, memoryRoot)))
    }

    if (area.description !== undefined) {
        result.description = area.description
    }

    return result
}

export async function loadTreeIndex(root: string, memoryRoot: string): Promise<TreeIndexState | RmemCommandError> {
    try {
        return parseTreeIndex(await readUtf8File(treeIndexPath(root, memoryRoot)), root, memoryRoot)
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return commandError({
                code: 'TREE_INDEX_NOT_FOUND',
                message: 'memory/tree-index.md was not found.',
                suggestion: 'Run rmem tree generate, then fill folder descriptions in memory/tree-index.md.'
            })
        }

        if (isNodeError(error)) {
            return commandError({
                code: 'TREE_INDEX_INVALID',
                message: 'Failed to read memory/tree-index.md.',
                details: String(error),
                suggestion: 'Repair tree-index.md or run rmem tree repair if a backup exists.'
            })
        }

        return commandError({
            code: 'TREE_INDEX_INVALID',
            message: 'memory/tree-index.md has invalid format.',
            details: String(error),
            suggestion: 'Use the strict bullet format inside the rmem tree-index markers.'
        })
    }
}

export async function mergeTreeIndex(root: string, config: RmemConfig): Promise<RmemConfig | RmemCommandError> {
    const tree = await loadTreeIndex(root, config.memoryRoot)
    if (isCommandErrorLike(tree)) {
        return tree
    }

    return {
        ...config,
        areas: areasFromTree(tree)
    }
}

export async function saveTreeIndex(root: string, memoryRoot: string, records: TreeIndexRecord[]): Promise<TreeIndexState> {
    const state: TreeIndexState = {
        schemaVersion: 1,
        treeIndexPath: toRegistryDocumentPath(relative(root, treeIndexPath(root, memoryRoot))),
        folders: records
    }

    await atomicWriteUtf8(treeIndexPath(root, memoryRoot), serializeTreeIndex(state))
    await saveTreeIndexBackup(root, state)
    return state
}

export async function saveTreeIndexBackup(root: string, state: TreeIndexState): Promise<void> {
    await atomicWriteUtf8(join(root, treeIndexBackupPath), `${JSON.stringify(state, null, 4)}\n`)
}

export async function loadTreeIndexBackup(root: string): Promise<TreeIndexState | RmemCommandError> {
    try {
        const parsed = JSON.parse(await readUtf8File(join(root, treeIndexBackupPath))) as TreeIndexState
        return parsed
    } catch (error) {
        return commandError({
            code: 'TREE_INDEX_NOT_FOUND',
            message: 'Tree index backup was not found.',
            details: String(error),
            suggestion: 'Create a new tree-index.md or run rmem tree generate.'
        })
    }
}

export async function generateTreeIndexFromFilesystem(root: string, memoryRoot: string): Promise<TreeIndexState> {
    const memoryRootPath = resolveMemoryPath(root, memoryRoot, '.')
    const folderPaths: string[][] = [['project']]
    await collectFolders(memoryRootPath, [], folderPaths)
    const unique = uniquePaths(folderPaths)
    const records = unique.map((path) => ({
        path,
        key: areaKeyFromPath(path),
        area: makeArea(path, '')
    }))

    return saveTreeIndex(root, memoryRoot, records)
}

export function areasFromTree(tree: TreeIndexState): RmemConfig['areas'] {
    const areas: RmemConfig['areas'] = {}
    for (const record of tree.folders) {
        areas[record.key] = record.area
    }
    return areas
}

export function parseTreeIndex(content: string, root: string, memoryRoot: string): TreeIndexState {
    const start = content.indexOf(treeIndexStart)
    const end = content.indexOf(treeIndexEnd)
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Tree index markers were not found.')
    }

    const body = content.slice(start + treeIndexStart.length, end)
    const records: TreeIndexRecord[] = []
    const seen = new Set<string>()

    for (const rawLine of body.split(/\r?\n/u)) {
        const line = rawLine.trim()
        if (line.length === 0) {
            continue
        }

        const match = /^-\s+`([^`]+)`\s+\u2014\s*(.*)$/u.exec(line)
        if (match === null) {
            throw new Error(`Invalid tree index line: ${rawLine}`)
        }

        const pathText = match[1] ?? ''
        const description = match[2] ?? ''
        const path = normalizeAreaPath(pathText)
        const pathError = validateAreaPath(path)
        if (pathError !== undefined) {
            throw new Error(pathError)
        }

        const key = areaKeyFromPath(path)
        if (seen.has(key)) {
            throw new Error(`Duplicate memory folder path: ${key}`)
        }
        seen.add(key)

        const parent = parentKeyFromPath(path)
        const area = makeArea(path, description)
        if (parent !== undefined) {
            area.parent = parent
        }
        records.push({ path, key, area })
    }

    if (!seen.has('project')) {
        throw new Error('Tree index must include project root folder.')
    }

    return {
        schemaVersion: 1,
        treeIndexPath: toRegistryDocumentPath(relative(root, treeIndexPath(root, memoryRoot))),
        folders: records
    }
}

export function serializeTreeIndex(state: TreeIndexState): string {
    const lines = [
        '# Memory Tree Index',
        '',
        'Опиши кожну папку коротко і конкретно. Порожні описи роблять памʼять неповною.',
        '',
        treeIndexStart,
        ''
    ]

    const sorted = [...state.folders].sort((left, right) => left.key.localeCompare(right.key))
    for (const record of sorted) {
        const indent = '  '.repeat(Math.max(0, record.path.length - 1))
        lines.push(`${indent}- \`${record.key}\` — ${record.area.description ?? ''}`)
    }

    lines.push('')
    lines.push(treeIndexEnd)
    lines.push('')
    return lines.join('\n')
}

export function makeArea(path: string[], description: string, title?: string): MemoryAreaConfig {
    const area: MemoryAreaConfig = {
        title: title ?? titleFromAreaKey(areaKeyFromPath(path)),
        description
    }
    const parent = parentKeyFromPath(path)
    if (parent !== undefined) {
        area.parent = parent
    }
    return area
}

async function collectFolders(directory: string, relativeUnits: string[], folderPaths: string[][]): Promise<void> {
    let entries
    try {
        entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return
        }
        throw error
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
            continue
        }

        const nextRelativeUnits = [...relativeUnits, entry.name]
        folderPaths.push(['project', ...nextRelativeUnits])
        await collectFolders(join(directory, entry.name), nextRelativeUnits, folderPaths)
    }
}

function uniquePaths(paths: string[][]): string[][] {
    const result: string[][] = []
    const seen = new Set<string>()
    for (const path of paths) {
        const key = areaKeyFromPath(path)
        if (!seen.has(key)) {
            seen.add(key)
            result.push(path)
        }
    }
    return result
}

function isCommandErrorLike(value: unknown): value is RmemCommandError {
    return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
}
