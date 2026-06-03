import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RmemConfig } from './types.js'
import { commandError, isCommandError } from './errors.js'
import type { RmemCommandError } from './types.js'
import { parseYamlObject } from './frontmatter.js'
import { atomicWriteUtf8 } from './storage.js'
import { mergeTreeIndex } from './areas.js'

export function defaultConfig(): RmemConfig {
    return {
        schemaVersion: 1,
        memoryRoot: 'memory',
        areas: {
            project: {
                title: 'Project',
                description: 'General project memory.'
            }
        },
        indexing: {
            noteRebuildMode: 'sync'
        },
        providers: {
            llm: {
                type: 'ollama',
                endpoint: 'http://localhost:11434',
                model: 'qwen2.5:7b'
            },
            embeddings: {
                type: 'flagembedding',
                endpoint: 'http://localhost:8765',
                model: 'BAAI/bge-m3'
            }
        }
    }
}

export async function ensureConfig(root: string): Promise<RmemConfig> {
    const config = await ensureBaseConfig(root)
    const merged = await mergeTreeIndex(root, config)
    if (isCommandError(merged)) {
        throw new Error(`${merged.code}: ${merged.message}`)
    }

    return merged
}

export async function ensureBaseConfig(root: string): Promise<RmemConfig> {
    const configPath = join(root, '.rmem', 'config.yaml')
    try {
        return await readBaseConfigFile(root)
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            const config = defaultConfig()
            await mkdir(dirname(configPath), { recursive: true })
            await mkdir(join(root, config.memoryRoot), { recursive: true })
            await saveConfig(root, config)
            return config
        }

        throw error
    }
}

export async function loadConfig(root: string): Promise<RmemConfig | RmemCommandError> {
    try {
        const merged = await mergeTreeIndex(root, await readBaseConfigFile(root))
        return merged
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            const merged = await mergeTreeIndex(root, defaultConfig())
            return merged
        }

        return commandError({
            code: 'INVALID_CONFIG',
            message: 'Failed to read rmem config.',
            details: String(error),
            suggestion: 'Check .rmem/config.yaml.'
        })
    }
}

export async function loadBaseConfig(root: string): Promise<RmemConfig | RmemCommandError> {
    try {
        return await readBaseConfigFile(root)
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return defaultConfig()
        }

        return commandError({
            code: 'INVALID_CONFIG',
            message: 'Failed to read rmem config.',
            details: String(error),
            suggestion: 'Check .rmem/config.yaml.'
        })
    }
}

async function readBaseConfigFile(root: string): Promise<RmemConfig> {
    const yamlPath = join(root, '.rmem', 'config.yaml')
    try {
        return parseConfig(await readFile(yamlPath, 'utf8'), 'yaml')
    } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
            throw error
        }
    }

    const jsonPath = join(root, '.rmem', 'config.json')
    return parseConfig(await readFile(jsonPath, 'utf8'), 'json')
}

export async function saveConfig(root: string, config: RmemConfig): Promise<void> {
    await mkdir(join(root, '.rmem'), { recursive: true })
    await atomicWriteUtf8(join(root, '.rmem', 'config.yaml'), serializeConfig(config))
}

function parseConfig(content: string, format: 'yaml' | 'json'): RmemConfig {
    const parsed = format === 'json'
        ? JSON.parse(content) as Partial<RmemConfig>
        : parseYamlObject(content) as Partial<RmemConfig>
    const defaultValue = defaultConfig()
    const noteRebuildMode = parsed.indexing?.noteRebuildMode

    if (noteRebuildMode !== undefined && noteRebuildMode !== 'sync' && noteRebuildMode !== 'manual') {
        throw new Error('indexing.noteRebuildMode must be sync or manual.')
    }

    const areas = parseAreas(parsed.areas, defaultValue.areas)
    const config: RmemConfig = {
        schemaVersion: parsed.schemaVersion ?? 1,
        memoryRoot: parsed.memoryRoot ?? 'memory',
        areas,
        indexing: {
            noteRebuildMode: noteRebuildMode ?? 'sync'
        }
    }

    const providers = parseProviders(parsed.providers)
    if (providers !== undefined) {
        config.providers = providers
    }

    return config
}

function parseAreas(value: unknown, defaultAreas: RmemConfig['areas']): RmemConfig['areas'] {
    if (value === undefined) {
        return defaultAreas
    }

    if (!isRecord(value)) {
        throw new Error('areas must be an object.')
    }

    const result: RmemConfig['areas'] = {}
    for (const [key, area] of Object.entries(value)) {
        if (!isRecord(area)) {
            throw new Error(`areas.${key} must be an object.`)
        }

        const title = stringField(area.title, `areas.${key}.title`)
        const parsedArea: RmemConfig['areas'][string] = { title }
        if (typeof area.description === 'string') {
            parsedArea.description = area.description
        }
        if (typeof area.parent === 'string') {
            parsedArea.parent = area.parent
        }

        result[key] = parsedArea
    }

    return result
}

function serializeConfig(config: RmemConfig): string {
    const lines: string[] = [
        `schemaVersion: ${config.schemaVersion}`,
        '',
        `memoryRoot: ${config.memoryRoot}`,
        '',
        'areas:'
    ]

    for (const [key, area] of Object.entries(config.areas)) {
        lines.push(`  ${key}:`)
        lines.push(`    title: ${yamlScalar(area.title)}`)
        if (area.description !== undefined) {
            lines.push(`    description: ${yamlScalar(area.description)}`)
        }
        if (area.parent !== undefined) {
            lines.push(`    parent: ${yamlScalar(area.parent)}`)
        }
    }

    lines.push('')
    lines.push('indexing:')
    lines.push(`  noteRebuildMode: ${config.indexing.noteRebuildMode}`)
    lines.push('')

    if (config.providers !== undefined) {
        lines.push('providers:')
        if (config.providers.llm !== undefined) {
            lines.push('  llm:')
            lines.push(`    type: ${config.providers.llm.type}`)
            lines.push(`    endpoint: ${yamlScalar(config.providers.llm.endpoint)}`)
            lines.push(`    model: ${yamlScalar(config.providers.llm.model)}`)
            if ('apiKey' in config.providers.llm && config.providers.llm.apiKey !== undefined) {
                lines.push(`    apiKey: ${yamlScalar(config.providers.llm.apiKey)}`)
            }
        }
        if (config.providers.embeddings !== undefined) {
            lines.push('  embeddings:')
            lines.push(`    type: ${config.providers.embeddings.type}`)
            lines.push(`    endpoint: ${yamlScalar(config.providers.embeddings.endpoint)}`)
            lines.push(`    model: ${yamlScalar(config.providers.embeddings.model)}`)
        }
        lines.push('')
    }

    return lines.join('\n')
}

function parseProviders(value: unknown): RmemConfig['providers'] {
    if (value === undefined) {
        return undefined
    }

    if (!isRecord(value)) {
        throw new Error('providers must be an object.')
    }

    const result: NonNullable<RmemConfig['providers']> = {}
    if (value.llm !== undefined) {
        if (!isRecord(value.llm)) {
            throw new Error('providers.llm must be an object.')
        }

        const type = stringField(value.llm.type, 'providers.llm.type')
        const endpoint = stringField(value.llm.endpoint, 'providers.llm.endpoint')
        const model = stringField(value.llm.model, 'providers.llm.model')
        if (type === 'ollama') {
            result.llm = { type, endpoint, model }
        } else if (type === 'openai-compatible') {
            result.llm = { type, endpoint, model }
            if (typeof value.llm.apiKey === 'string') {
                result.llm.apiKey = value.llm.apiKey
            }
        } else {
            throw new Error('providers.llm.type must be ollama or openai-compatible.')
        }
    }

    if (value.embeddings !== undefined) {
        if (!isRecord(value.embeddings)) {
            throw new Error('providers.embeddings must be an object.')
        }

        const type = stringField(value.embeddings.type, 'providers.embeddings.type')
        const endpoint = stringField(value.embeddings.endpoint, 'providers.embeddings.endpoint')
        const model = stringField(value.embeddings.model, 'providers.embeddings.model')
        if (type !== 'flagembedding') {
            throw new Error('providers.embeddings.type must be flagembedding.')
        }

        result.embeddings = { type, endpoint, model }
    }

    return result
}

function yamlScalar(value: string): string {
    if (/^[A-Za-z0-9_\-.:/+]+$/.test(value)) {
        return value
    }

    return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown, field: string): string {
    if (typeof value === 'string' && value.length > 0) {
        return value
    }

    throw new Error(`${field} must be a non-empty string.`)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
}
