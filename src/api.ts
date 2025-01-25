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
}


export class Api {

    authProvider: AuthProvider
    cache: KVS
    host: string = ''

    constructor(authProvider: AuthProvider, cache: KVS) {
        this.cache = cache
        this.authProvider = authProvider
    }

    // GET:/api/v1/message/:id
    async getMessage<T>(id: string, host: string = ''): Promise<Message<T> | null> {

        const cacheKey = `message:${id}`
        const cached = await this.cache.get<Message<T>>(cacheKey)
        if (cached) {
            return cached
        }

        const authHeaders = await this.authProvider.getHeaders(host)

        const requestOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            }
        }

        const messageHost = host || this.host
        const req = fetch(`https://${messageHost}/${apiPath}/message/${id}`, requestOptions).then(async (res) => {

            if (!res.ok) {
                if (res.status === 404) return null 
                return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
            }

            const data = await res.json()
            if (data.status != 'ok') {
                return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
            }

            return data.content
        })

        this.cache.set(cacheKey, req)
        return req
    }


}

