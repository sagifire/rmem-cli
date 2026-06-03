import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const toolsRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(toolsRoot, '..')
const runtimeRoot = join(repoRoot, '.runtime')
const npmCache = join(runtimeRoot, 'npm-cache')

mkdirSync(npmCache, { recursive: true })

const npm = npmInvocation()
run(npm.command, [...npm.args, 'pack', '--workspaces', '--dry-run'], repoRoot)

function run(command, args, cwd, options = {}) {
    const result = spawnSync(command, args, {
        cwd,
        stdio: 'inherit',
        shell: options.shell === true,
        env: {
            ...process.env,
            npm_config_cache: npmCache
        }
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}

function npmInvocation() {
    const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(npmCli)) {
        return {
            command: process.execPath,
            args: [npmCli]
        }
    }

    return {
        command: 'npm',
        args: []
    }
}
