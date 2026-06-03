import type { RmemDocumentFrontmatter } from '../types.js'

export const managedHeaderStart = '<!-- rmem:managed-header start -->'
export const managedHeaderEnd = '<!-- rmem:managed-header end -->'

export function generateManagedHeader(frontmatter: RmemDocumentFrontmatter): string {
    const memoryPath = frontmatter.rmem.memoryPath
        .map((unit) => titleCase(unit))
        .join(' → ')

    const lines = [
        managedHeaderStart,
        '',
        `# ${frontmatter.title}`,
        '',
        `**Тип документа:** ${frontmatter.rmem.kind}  `,
        `**Статус:** ${frontmatter.rmem.status}  `,
        `**Створено:** ${formatDate(frontmatter.rmem.createdAt)}  `,
        `**Оновлено:** ${formatDate(frontmatter.rmem.updatedAt)}  `,
        `**Ревізія:** ${frontmatter.rmem.revision}  `,
        `**Локація памʼяті:** ${memoryPath}  `,
        `**Мова:** ${frontmatter.rmem.language}  `
    ]

    if (frontmatter.summary !== undefined && frontmatter.summary.length > 0) {
        lines.push('')
        lines.push('**Короткий зміст:**  ')
        lines.push(frontmatter.summary)
    }

    lines.push('')
    lines.push(managedHeaderEnd)

    return lines.join('\n')
}

export function replaceManagedHeader(body: string, frontmatter: RmemDocumentFrontmatter): string {
    const generated = generateManagedHeader(frontmatter)
    const start = body.indexOf(managedHeaderStart)
    const end = body.indexOf(managedHeaderEnd)

    if (start !== -1 && end !== -1 && end > start) {
        const after = end + managedHeaderEnd.length
        return `${body.slice(0, start)}${generated}${body.slice(after)}`.replace(/^\n+/, '')
    }

    return `${generated}\n\n${body.replace(/^\n+/, '')}`
}

export function stripManagedHeader(body: string): string {
    const start = body.indexOf(managedHeaderStart)
    const end = body.indexOf(managedHeaderEnd)

    if (start === -1 || end === -1 || end <= start) {
        return body
    }

    return `${body.slice(0, start)}${body.slice(end + managedHeaderEnd.length)}`.replace(/^\n+/, '')
}

export function hasManagedHeaderMismatch(body: string, frontmatter: RmemDocumentFrontmatter): boolean {
    const start = body.indexOf(managedHeaderStart)
    const end = body.indexOf(managedHeaderEnd)

    if (start === -1 || end === -1 || end <= start) {
        return true
    }

    const current = body.slice(start, end + managedHeaderEnd.length).trim()
    return current !== generateManagedHeader(frontmatter).trim()
}

function formatDate(value: string): string {
    return value.replace('T', ' ').replace(/:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/, '')
}

function titleCase(value: string): string {
    return value.slice(0, 1).toUpperCase() + value.slice(1)
}
