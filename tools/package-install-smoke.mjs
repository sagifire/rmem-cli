import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const toolsRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(toolsRoot, '..')
const runtimeRoot = join(repoRoot, '.runtime')
const smokeRoot = join(runtimeRoot, 'package-install-smoke')
const packRoot = join(smokeRoot, 'pack')
const appRoot = join(smokeRoot, 'app')
const npmCache = join(runtimeRoot, 'npm-cache')

rmSync(smokeRoot, { recursive: true, force: true })
mkdirSync(packRoot, { recursive: true })
mkdirSync(appRoot, { recursive: true })
mkdirSync(npmCache, { recursive: true })

const npm = npmInvocation()
run(npm.command, [...npm.args, 'pack', '--workspaces', '--pack-destination', packRoot, '--silent'], repoRoot)

const corePackage = findPackage('rmem-core-')
const cliPackage = findPackage('rmem-cli-')

run(npm.command, [...npm.args, 'init', '-y'], appRoot, { quiet: true })
run(npm.command, [...npm.args, 'install', '--ignore-scripts', '--no-audit', '--no-fund', corePackage, cliPackage], appRoot, { quiet: true })

const rmemBin = process.platform === 'win32'
    ? join(appRoot, 'node_modules', '.bin', 'rmem.cmd')
    : join(appRoot, 'node_modules', '.bin', 'rmem')
const rmemCli = join(appRoot, 'node_modules', 'rmem-cli', 'dist', 'main.js')

if (!existsSync(rmemBin)) {
    throw new Error('rmem binary was not installed.')
}

if (!existsSync(rmemCli)) {
    throw new Error('rmem CLI entrypoint was not installed.')
}

const version = runJson(process.execPath, [rmemCli, '--version'], appRoot)
if (version.ok !== true || version.version !== '1.0.0') {
    throw new Error(`Unexpected rmem --version output: ${JSON.stringify(version)}`)
}

const docPath = join(appRoot, 'doc.md')
writeFileSync(docPath, '# Package Smoke\n\nInstalled package writes canonical memory.\n', 'utf8')
run(process.execPath, [rmemCli, 'write', 'smoke.md', '--from', docPath], appRoot, { quiet: true })

const check = runJson(process.execPath, [rmemCli, 'check'], appRoot)
if (check.ok !== true || check.valid !== true) {
    throw new Error(`Installed package check failed: ${JSON.stringify(check)}`)
}

console.log('Package install smoke passed.')

function findPackage(prefix) {
    const packageName = readdirSync(packRoot).find((name) => name.startsWith(prefix) && name.endsWith('.tgz'))
    if (packageName === undefined) {
        throw new Error(`${prefix} package tarball was not created.`)
    }

    return join(packRoot, packageName)
}

function runJson(command, args, cwd) {
    const result = run(command, args, cwd, { capture: true })
    return JSON.parse(result.stdout)
}

function run(command, args, cwd, options = {}) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: options.capture ? 'pipe' : options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        shell: options.shell === true,
        env: {
            ...process.env,
            npm_config_cache: npmCache
        }
    })

    if (result.status !== 0) {
        const stderr = result.stderr === null ? '' : result.stderr
        const stdout = result.stdout === null ? '' : result.stdout
        throw new Error(`Command failed: ${command} ${args.join(' ')}\n${stdout}\n${stderr}`)
    }

    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
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
