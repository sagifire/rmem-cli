import type {
    EmbeddingProvider,
    EmbeddingVector,
    FlagEmbeddingProviderConfig,
    LlmTask,
    LocalLlmProvider,
    OllamaLlmProviderConfig,
    OpenAiCompatibleLlmProviderConfig,
    RmemConfig
} from './types.js'

export type ProviderHealthReport = {
    ok: true
    providers: {
        llm?: ProviderStatus
        embeddings?: ProviderStatus
    }
} | {
    ok: false
    providers: {
        llm?: ProviderStatus
        embeddings?: ProviderStatus
    }
}

export type ProviderStatus = {
    ok: boolean
    type: string
    endpoint: string
    model: string
    message: string
    details?: unknown
}

export class OllamaLlmProvider implements LocalLlmProvider {
    constructor(private readonly config: OllamaLlmProviderConfig) {}

    async generateJson<TInput, TOutput>(
        task: LlmTask<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput> {
        const response = await fetch(`${trimSlash(this.config.endpoint)}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.config.model,
                prompt: [
                    task.description,
                    'Return only valid JSON. Do not wrap the response in Markdown.',
                    JSON.stringify(input)
                ].join('\n\n'),
                format: 'json',
                stream: false
            })
        })

        if (!response.ok) {
            throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`)
        }

        const payload = await response.json() as { response?: string }
        if (typeof payload.response !== 'string') {
            throw new Error('Ollama response does not contain response text.')
        }

        return JSON.parse(stripJsonFence(payload.response)) as TOutput
    }
}

export class OpenAiCompatibleLlmProvider implements LocalLlmProvider {
    constructor(private readonly config: OpenAiCompatibleLlmProviderConfig) {}

    async generateJson<TInput, TOutput>(
        task: LlmTask<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }
        if (this.config.apiKey !== undefined) {
            headers.Authorization = `Bearer ${this.config.apiKey}`
        }

        const response = await fetch(`${trimSlash(this.config.endpoint)}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.config.model,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: `${task.description}\nReturn only valid JSON.`
                    },
                    {
                        role: 'user',
                        content: JSON.stringify(input)
                    }
                ]
            })
        })

        if (!response.ok) {
            throw new Error(`OpenAI-compatible request failed: ${response.status} ${response.statusText}`)
        }

        const payload = await response.json() as {
            choices?: { message?: { content?: string } }[]
        }
        const content = payload.choices?.[0]?.message?.content
        if (typeof content !== 'string') {
            throw new Error('OpenAI-compatible response does not contain message content.')
        }

        return JSON.parse(stripJsonFence(content)) as TOutput
    }
}

export class FlagEmbeddingHttpProvider implements EmbeddingProvider {
    constructor(private readonly config: FlagEmbeddingProviderConfig) {}

    async embedTexts(texts: string[]): Promise<EmbeddingVector[]> {
        const response = await fetch(`${trimSlash(this.config.endpoint)}/embed`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.config.model,
                texts
            })
        })

        if (!response.ok) {
            throw new Error(`FlagEmbedding request failed: ${response.status} ${response.statusText}`)
        }

        const payload = await response.json() as { embeddings?: unknown }
        if (!Array.isArray(payload.embeddings)) {
            throw new Error('FlagEmbedding response does not contain embeddings array.')
        }

        return payload.embeddings as EmbeddingVector[]
    }
}

export async function checkProviders(config: RmemConfig): Promise<ProviderHealthReport> {
    const providers: ProviderHealthReport['providers'] = {}

    if (config.providers?.llm !== undefined) {
        providers.llm = await checkLlm(config.providers.llm)
    }

    if (config.providers?.embeddings !== undefined) {
        providers.embeddings = await checkEmbeddings(config.providers.embeddings)
    }

    const ok = (providers.llm?.ok ?? true) && (providers.embeddings?.ok ?? true)
    return {
        ok,
        providers
    }
}

async function checkLlm(config: OllamaLlmProviderConfig | OpenAiCompatibleLlmProviderConfig): Promise<ProviderStatus> {
    try {
        if (config.type === 'ollama') {
            const response = await fetch(`${trimSlash(config.endpoint)}/api/tags`)
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`)
            }
        } else {
            const requestInit: RequestInit = {}
            if (config.apiKey !== undefined) {
                requestInit.headers = { Authorization: `Bearer ${config.apiKey}` }
            }

            const response = await fetch(`${trimSlash(config.endpoint)}/models`, requestInit)
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`)
            }
        }

        return {
            ok: true,
            type: config.type,
            endpoint: config.endpoint,
            model: config.model,
            message: 'Provider is reachable.'
        }
    } catch (error) {
        return {
            ok: false,
            type: config.type,
            endpoint: config.endpoint,
            model: config.model,
            message: 'Provider is not reachable.',
            details: String(error)
        }
    }
}

async function checkEmbeddings(config: FlagEmbeddingProviderConfig): Promise<ProviderStatus> {
    try {
        const response = await fetch(`${trimSlash(config.endpoint)}/health`)
        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`)
        }

        const details = await response.json()
        return {
            ok: true,
            type: config.type,
            endpoint: config.endpoint,
            model: config.model,
            message: 'Provider is reachable.',
            details
        }
    } catch (error) {
        return {
            ok: false,
            type: config.type,
            endpoint: config.endpoint,
            model: config.model,
            message: 'Provider is not reachable.',
            details: String(error)
        }
    }
}

function trimSlash(value: string): string {
    return value.replace(/\/+$/, '')
}

function stripJsonFence(value: string): string {
    return value
        .trim()
        .replace(/^```(?:json)?/u, '')
        .replace(/```$/u, '')
        .trim()
}
