import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    buildVectorIndex,
    FlagEmbeddingHttpProvider,
    OllamaLlmProvider,
    OpenAiCompatibleLlmProvider,
    checkProviders,
    isVectorIndexCompatible,
    type EmbeddingProvider,
    type EmbeddingVector
} from '../packages/rmem-core/dist/index.js'

type RecordedRequest = {
    method: string
    path: string
    body: unknown
}

type TestServer = {
    endpoint: string
    requests: RecordedRequest[]
    close: () => Promise<void>
}

class RejectingEmptyEmbeddingProvider implements EmbeddingProvider {
    public calls = 0

    async embedTexts(texts: string[]): Promise<EmbeddingVector[]> {
        this.calls += 1
        if (texts.length === 0) {
            throw new Error('Provider must not be called for empty note sets.')
        }

        return texts.map(() => [1, 0, 0])
    }
}

test('vector index rebuild does not call embedding provider for empty note set', async () => {
    const provider = new RejectingEmptyEmbeddingProvider()
    const index = await buildVectorIndex({
        notes: [],
        provider,
        providerName: 'flagembedding',
        model: 'BAAI/bge-m3',
        now: '2026-06-03T00:00:00.000Z'
    })

    assert.equal(provider.calls, 0)
    assert.equal(index.provider, 'flagembedding')
    assert.equal(index.model, 'BAAI/bge-m3')
    assert.equal(index.dimensions, 0)
    assert.deepEqual(index.vectors, [])
    assert.equal(isVectorIndexCompatible(index, 'flagembedding', 'BAAI/bge-m3'), true)
})

test('Ollama provider sends generate request and parses JSON response', async () => {
    const server = await startJsonServer((request) => {
        assert.equal(request.method, 'POST')
        assert.equal(request.path, '/api/generate')
        assert.equal((request.body as { model?: unknown }).model, 'qwen2.5:7b')
        assert.equal((request.body as { format?: unknown }).format, 'json')

        return {
            response: JSON.stringify({
                title: 'Compiled note',
                sourceQuote: 'Grounded text.',
                canonicalStatement: 'Grounded text.'
            })
        }
    })

    try {
        const provider = new OllamaLlmProvider({
            type: 'ollama',
            endpoint: server.endpoint,
            model: 'qwen2.5:7b'
        })
        const result = await provider.generateJson<{ text: string }, { title: string }>({
            name: 'test',
            description: 'Return JSON.'
        }, { text: 'Grounded text.' })

        assert.equal(result.title, 'Compiled note')
        assert.equal(server.requests.length, 1)
    } finally {
        await server.close()
    }
})

test('OpenAI-compatible provider sends chat completion request and parses JSON response', async () => {
    const server = await startJsonServer((request) => {
        assert.equal(request.method, 'POST')
        assert.equal(request.path, '/chat/completions')
        assert.equal((request.body as { model?: unknown }).model, 'local-json-model')

        return {
            choices: [{
                message: {
                    content: JSON.stringify({ ok: true })
                }
            }]
        }
    })

    try {
        const provider = new OpenAiCompatibleLlmProvider({
            type: 'openai-compatible',
            endpoint: server.endpoint,
            model: 'local-json-model',
            apiKey: 'token'
        })
        const result = await provider.generateJson<{ text: string }, { ok: boolean }>({
            name: 'test',
            description: 'Return JSON.'
        }, { text: 'input' })

        assert.equal(result.ok, true)
        assert.equal(server.requests.length, 1)
    } finally {
        await server.close()
    }
})

test('FlagEmbedding provider sends embed request and returns vectors', async () => {
    const server = await startJsonServer((request) => {
        assert.equal(request.method, 'POST')
        assert.equal(request.path, '/embed')
        const body = request.body as { model?: unknown, texts?: unknown }
        assert.equal(body.model, 'BAAI/bge-m3')
        assert.deepEqual(body.texts, ['one', 'two'])

        return {
            embeddings: [
                [1, 0, 0],
                [0, 1, 0]
            ]
        }
    })

    try {
        const provider = new FlagEmbeddingHttpProvider({
            type: 'flagembedding',
            endpoint: server.endpoint,
            model: 'BAAI/bge-m3'
        })
        const vectors = await provider.embedTexts(['one', 'two'])

        assert.deepEqual(vectors, [[1, 0, 0], [0, 1, 0]])
        assert.equal(server.requests.length, 1)
    } finally {
        await server.close()
    }
})

test('provider health check uses configured endpoints', async () => {
    const server = await startJsonServer((request) => {
        if (request.path === '/api/tags') {
            return { models: [] }
        }

        if (request.path === '/health') {
            return { ok: true, device: 'cpu' }
        }

        return { ok: false }
    })

    try {
        const result = await checkProviders({
            schemaVersion: 1,
            memoryRoot: 'memory',
            areas: { project: { title: 'Project' } },
            indexing: { noteRebuildMode: 'sync' },
            providers: {
                llm: {
                    type: 'ollama',
                    endpoint: server.endpoint,
                    model: 'qwen2.5:7b'
                },
                embeddings: {
                    type: 'flagembedding',
                    endpoint: server.endpoint,
                    model: 'BAAI/bge-m3'
                }
            }
        })

        assert.equal(result.ok, true)
        assert.equal(result.providers.llm?.ok, true)
        assert.equal(result.providers.embeddings?.ok, true)
        assert.equal(server.requests.some((request) => request.path === '/api/tags'), true)
        assert.equal(server.requests.some((request) => request.path === '/health'), true)
    } finally {
        await server.close()
    }
})

test('provider health check respects timeout environment override', async () => {
    const previousTimeout = process.env.RMEM_PROVIDER_TIMEOUT_MS
    process.env.RMEM_PROVIDER_TIMEOUT_MS = '20'
    const server = createServer((_request: IncomingMessage, _response: ServerResponse) => {
        return undefined
    })

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address()
    if (typeof address !== 'object' || address === null) {
        throw new Error('Test server did not bind to a TCP port.')
    }

    try {
        const result = await checkProviders({
            schemaVersion: 1,
            memoryRoot: 'memory',
            areas: { project: { title: 'Project' } },
            indexing: { noteRebuildMode: 'sync' },
            providers: {
                llm: {
                    type: 'ollama',
                    endpoint: `http://127.0.0.1:${address.port}`,
                    model: 'qwen2.5:7b'
                }
            }
        })

        assert.equal(result.ok, false)
        assert.equal(result.providers.llm?.ok, false)
    } finally {
        if (previousTimeout === undefined) {
            delete process.env.RMEM_PROVIDER_TIMEOUT_MS
        } else {
            process.env.RMEM_PROVIDER_TIMEOUT_MS = previousTimeout
        }

        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error !== undefined) {
                    reject(error)
                    return
                }

                resolve()
            })
        })
    }
})

async function startJsonServer(handler: (request: RecordedRequest) => unknown): Promise<TestServer> {
    const requests: RecordedRequest[] = []
    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
        try {
            const bodyText = await readRequestBody(request)
            const recorded: RecordedRequest = {
                method: request.method ?? '',
                path: request.url ?? '',
                body: bodyText.length > 0 ? JSON.parse(bodyText) as unknown : undefined
            }
            requests.push(recorded)
            response.writeHead(200, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify(handler(recorded)))
        } catch (error) {
            response.writeHead(500, { 'Content-Type': 'application/json' })
            response.end(JSON.stringify({ error: String(error) }))
        }
    })

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address()
    if (typeof address !== 'object' || address === null) {
        throw new Error('Test server did not bind to a TCP port.')
    }

    return {
        endpoint: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error !== undefined) {
                    reject(error)
                    return
                }

                resolve()
            })
        })
    }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    }

    return Buffer.concat(chunks).toString('utf8')
}
