import { CCDocument, Message, Schema, TimelineID } from "./model"
import { KVS } from "./cache/main"
import { AuthProvider } from "./auth/main"

const apiPath = '/api/v1'

class DomainOfflineError extends Error {
    constructor(domain: string) {
        super(`domain ${domain} is offline`)
    }
}

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

    private isHostOnline = async (host: string): Promise<boolean> => {
        const cacheKey = `online:${host}`
        const entry = await this.cache.get<number>(cacheKey)
        if (entry) {
            const age = Date.now() - entry.timestamp
            const threshold = 500 * Math.pow(1.5, Math.min(entry.data, 15))
            if (age < threshold) {
                return false
            }
        }
        return true
    }

    private markHostOnline = async (host: string) => {
        const cacheKey = `online:${host}`
        this.cache.invalidate(cacheKey)
    }

    private markHostOffline = async (host: string) => {
        const cacheKey = `online:${host}`
        const failCount = (await this.cache.get<number>(cacheKey))?.data ?? 0
        this.cache.set(cacheKey, failCount + 1)
    }

    // Gets
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
            const fetchHost = host || this.host
            const url = `https://${fetchHost}${path}`

            if (!(await this.isHostOnline(fetchHost))) {
                return Promise.reject(new DomainOfflineError(fetchHost))
            }

            if (this.inFlightRequests.has(cacheKey)) {
                return this.inFlightRequests.get(cacheKey)
            }

            const authHeaders = await this.authProvider.getHeaders(fetchHost)

            const requestOptions = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders
                }
            }
            
            const req = fetch(url, requestOptions).then(async (res) => {

                if ([502, 503, 504].includes(res.status)) {
                    await this.markHostOffline(fetchHost)
                    return await Promise.reject(new DomainOfflineError(fetchHost))
                }

                if (!res.ok) {
                    if (res.status === 404) return null 
                    return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
                }

                this.markHostOnline(fetchHost)

                const data: ApiResponse<T> = await res.json()
                if (data.status != 'ok') {
                    return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
                }
                
                opts?.expressGetter?.(data.content)
                this.cache.set(cacheKey, data.content)

                return data.content

            }).catch(async (err) => {

                if (err instanceof DomainOfflineError) {
                    return Promise.reject(err)
                }

                if (['ENOTFOUND', 'ECONNREFUSED'].includes(err.cause?.code)) {
                    await this.markHostOffline(fetchHost)
                    return Promise.reject(new DomainOfflineError(fetchHost))
                }

                return Promise.reject(err)

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


    // Posts
    async commit<T>(obj: any, host: string = ''): Promise<T> {

        const document = JSON.stringify(obj)
        const signature = this.authProvider.sign(document)

        const requestOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                document,
                signature
            })
        }

        const authHeaders = await this.authProvider.getHeaders(host)
        Object.assign(requestOptions.headers, authHeaders)

        return await fetch(`https://${host || this.host}${apiPath}/commit`, requestOptions)
            .then(async (res) => await res.json())
            .then((data) => {
                return data.content
            })
    }

    async createMessage<T>(
        schema: Schema,
        body: T,
        timelines: TimelineID[],
        { policy = undefined, policyParams = undefined, policyDefaults = undefined }: { policy?: string, policyParams?: string, policyDefaults?: string } = {}
    ): Promise<any> {


        const ccid = this.authProvider.getCCID()
        const ckid = this.authProvider.getCKID()

        const documentObj: CCDocument.Message<T> = {
            signer: ccid,
            type: 'message',
            schema,
            body,
            meta: {
                //client: this.client
            },
            timelines,
            signedAt: new Date(),
            policy,
            policyParams,
            policyDefaults
        }

        if (ckid) {
            documentObj.keyID = ckid
        }

        return await this.commit(documentObj)
    }


}

