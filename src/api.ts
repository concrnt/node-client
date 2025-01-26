import { Message } from "./model"
import { KVS } from "./cache/main"
import { AuthProvider } from "./auth/main"

const apiPath = '/api/v1'

class DomainOfflineError extends Error {
    constructor(domain: string) {
        super(`domain ${domain} is offline`)
    }
}

class InvalidKeyError extends Error {
    constructor() {
        super('Invalid key')
    }
}

// Todo
// - cacheレイヤーを注入できるようにする
// - クレデンシャルを注入できるようにする (ログインユーザー/ゲスト)
// ドメインがオフライン時の処理(リトライ)
// キャッシュの有効期限

export interface ApiResponse<T> {
    content: T
    status: 'ok' | 'error'
    error: string
}

export interface FetchOptions<T> {
    cache?: 'force-cache' | 'no-cache' | 'swr'
    expressGetter?: (data: T) => void
    ttl?: number
}

export class Api {

    authProvider: AuthProvider
    cache: KVS
    host: string = ''

    private inFlightRequests = new Map<string, Promise<any>>()

    constructor(authProvider: AuthProvider, cache: KVS) {
        this.cache = cache
        this.authProvider = authProvider
    }

    private async fetchResource<T>(
        host: string,
        path: string,
        cacheKey: string,
        opts?: FetchOptions<T>
    ): Promise<T | null> {

        let cached: T | null = null
        if (opts?.cache !== 'no-cache') {
            const cachedEntry = await this.cache.get<T>(cacheKey)
            if (cachedEntry) {
                opts?.expressGetter?.(cachedEntry.data)

                const age = Date.now() - cachedEntry.timestamp
                if (age > (opts?.ttl ?? Infinity)) {
                    this.cache.invalidate(cacheKey)
                } else {
                    cached = cachedEntry.data
                    if (opts?.cache !== 'swr') return cachedEntry.data
                }
            }
        }
        if (opts?.cache === 'force-cache') return null

        const fetchNetwork = async (): Promise<T | null> => {
            const url = `https://${host || this.host}${path}`

            if (this.inFlightRequests.has(cacheKey)) {
                return this.inFlightRequests.get(cacheKey)
            }

            const authHeaders = await this.authProvider.getHeaders(host)

            const requestOptions = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders
                }
            }
            
            const req = fetch(url, requestOptions).then(async (res) => {

                if (!res.ok) {
                    if (res.status === 404) return null 
                    return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
                }

                const data: ApiResponse<T> = await res.json()
                if (data.status != 'ok') {
                    return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
                }
                
                opts?.expressGetter?.(data.content)
                this.cache.set(cacheKey, data.content)

                return data.content
            }).finally(() => {
                this.inFlightRequests.delete(cacheKey)
            })
            this.inFlightRequests.set(cacheKey, req)

            return req
        }

        if (opts?.cache === 'swr' && cached) {
            fetchNetwork()
            return cached
        }

        return await fetchNetwork()
    }

    // GET:/api/v1/message/:id
    async getMessage<T>(id: string, host: string = '', opts?: FetchOptions<Message<T>>): Promise<Message<T> | null> {
        const cacheKey = `message:${id}`
        const path = `${apiPath}/message/${id}`
        return await this.fetchResource(host, path, cacheKey, opts)
    }


}

