import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RmemConfig } from './types.js'
import { commandError } from './errors.js'
import type { RmemCommandError } from './types.js'

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
        }
    }
}

export async function ensureConfig(root: string): Promise<RmemConfig> {
    const configPath = join(root, '.rmem', 'config.json')

    try {
        const content = await readFile(configPath, 'utf8')
        return parseConfig(content)
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            const config = defaultConfig()
            await mkdir(dirname(configPath), { recursive: true })
            await writeFile(configPath, JSON.stringify(config, null, 4), 'utf8')
            await mkdir(join(root, config.memoryRoot), { recursive: true })
            return config
        }

        throw error
    }
}

export async function loadConfig(root: string): Promise<RmemConfig | RmemCommandError> {
    const configPath = join(root, '.rmem', 'config.json')

    try {
        const content = await readFile(configPath, 'utf8')
        return parseConfig(content)
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return commandError({
                code: 'CONFIG_NOT_FOUND',
                message: '.rmem/config.json was not found.',
                suggestion: 'Run any write command first or create .rmem/config.json.'
            })
        }

        return commandError({
            code: 'INVALID_CONFIG',
            message: 'Failed to read rmem config.',
            details: String(error),
            suggestion: 'Check .rmem/config.json.'
        })
    }
}

function parseConfig(content: string): RmemConfig {
    const parsed = JSON.parse(content) as Partial<RmemConfig>
    return {
        schemaVersion: parsed.schemaVersion ?? 1,
        memoryRoot: parsed.memoryRoot ?? 'memory',
        areas: parsed.areas ?? defaultConfig().areas,
        indexing: {
            noteRebuildMode: parsed.indexing?.noteRebuildMode ?? 'sync'
        }
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
}
