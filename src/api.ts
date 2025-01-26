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
}

export class Api {

    authProvider: AuthProvider
    cache: KVS
    host: string = ''

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
            cached = await this.cache.get<T>(cacheKey)
            if (cached) {
                opts?.expressGetter?.(cached)
                if (opts?.cache !== 'swr' && !opts?.expressGetter) return cached
            }
        }
        if (opts?.cache === 'force-cache') return null

        const fetchNetwork = async (): Promise<T | null> => {
            const authHeaders = await this.authProvider.getHeaders(host)

            const requestOptions = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders
                }
            }

            const req = fetch(`https://${host || this.host}${path}`, requestOptions).then(async (res) => {

                if (!res.ok) {
                    if (res.status === 404) return null 
                    return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
                }

                const data: ApiResponse<T> = await res.json()
                if (data.status != 'ok') {
                    return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
                }
                
                opts?.expressGetter?.(data.content)
                return data.content
            })

            this.cache.set(cacheKey, req)

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

