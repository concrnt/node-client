import {
    Ack,
    Association,
    CCDocument,
    CCID,
    CKID,
    Domain,
    Entity,
    IsCCID,
    IsCSID,
    Key,
    Message,
    Profile,
    Schema,
    Subscription,
    Timeline,
    TimelineID,
    TimelineItem
} from "./model"
import { KVS } from "./cache/main"
import { AuthProvider } from "./auth/main"
import { fetchWithTimeout } from "./util"

const apiPath = '/api/v1'

export class DomainOfflineError extends Error {
    constructor(domain: string) {
        super(`domain ${domain} is offline`)
    }
}

export class NotFoundError extends Error {
    constructor(msg: string) {
        super(msg)
    }
}

export interface ApiResponse<T> {
    content: T
    status: 'ok' | 'error'
    error: string
}

export interface FetchOptions<T> {
    cache?: 'force-cache' | 'no-cache' | 'swr' | 'best-effort'
    expressGetter?: (data: T) => void
    TTL?: number
    auth?: 'no-auth'
    timeoutms?: number
}

export class Api {

    authProvider: AuthProvider
    cache: KVS
    defaultHost: string = ''
    negativeCacheTTL: number = 300

    private inFlightRequests = new Map<string, Promise<any>>()

    constructor(authProvider: AuthProvider, cache: KVS) {
        this.cache = cache
        this.authProvider = authProvider

        this.defaultHost = authProvider.getHost()
    }

    getDomainOnlineStatus = async (host: string): Promise<boolean> => {
        const cacheKey = `online:${host}`
        const entry = await this.cache.get<number>(cacheKey)
        if (entry) {
            const age = Date.now() - entry.timestamp
            if (age < 5000) {
                return true
            }
        }

        return await this.getDomain(host, { cache: 'no-cache' }).then(() => {
            this.cache.set(cacheKey, 1)
            return true
        }).catch(() => {
            this.cache.invalidate(cacheKey)
            return false
        })
    }

    private isHostOnline = async (host: string): Promise<boolean> => {
        const cacheKey = `offline:${host}`
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
        const cacheKey = `offline:${host}`
        this.cache.invalidate(cacheKey)
    }

    private markHostOffline = async (host: string) => {
        const cacheKey = `offline:${host}`
        const failCount = (await this.cache.get<number>(cacheKey))?.data ?? 0
        this.cache.set(cacheKey, failCount + 1)
    }

    async fetchWithCredentialBlob(
        host: string,
        path: string,
        init: RequestInit = {},
        timeoutms?: number
    ): Promise<Blob> {

        const fetchNetwork = async (): Promise<Blob> => {
            const fetchHost = host || this.defaultHost
            const url = `https://${fetchHost}${path}`

            if (!(await this.isHostOnline(fetchHost))) {
                return Promise.reject(new DomainOfflineError(fetchHost))
            }

            const authHeaders = await this.authProvider.getHeaders(fetchHost)

            init.headers = {
                ...init.headers,
                ...authHeaders
            }
            
            const req = fetchWithTimeout(url, init, timeoutms).then(async (res) => {

                if ([502, 503, 504].includes(res.status)) {
                    await this.markHostOffline(fetchHost)
                    return await Promise.reject(new DomainOfflineError(fetchHost))
                }

                if (!res.ok) {
                    return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
                }

                this.markHostOnline(fetchHost)

                return await res.blob()

            }).catch(async (err) => {

                if (err instanceof DomainOfflineError) {
                    return Promise.reject(err)
                }

                if (['ENOTFOUND', 'ECONNREFUSED'].includes(err.cause?.code)) {
                    await this.markHostOffline(fetchHost)
                    return Promise.reject(new DomainOfflineError(fetchHost))
                }

                return Promise.reject(err)

            })

            return req
        }

        return await fetchNetwork()
    }

    // Gets
    async fetchWithCredential<T>(
        host: string,
        path: string,
        init: RequestInit = {},
        timeoutms?: number
    ): Promise<T> {

        const fetchNetwork = async (): Promise<T> => {
            const fetchHost = host || this.defaultHost
            const url = `https://${fetchHost}${path}`

            if (!(await this.isHostOnline(fetchHost))) {
                return Promise.reject(new DomainOfflineError(fetchHost))
            }

            const authHeaders = await this.authProvider.getHeaders(fetchHost)

            init.headers = {
                'Accept': 'application/json',
                ...init.headers,
                ...authHeaders
            }
            
            const req = fetchWithTimeout(url, init, timeoutms).then(async (res) => {

                if ([502, 503, 504].includes(res.status)) {
                    await this.markHostOffline(fetchHost)
                    return await Promise.reject(new DomainOfflineError(fetchHost))
                }

                if (!res.ok) {
                    return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
                }

                this.markHostOnline(fetchHost)

                const data: ApiResponse<T> = await res.json()
                if (data.status != 'ok') {
                    return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
                }

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

            })

            return req
        }

        return await fetchNetwork()
    }


    async fetchWithCache<T>(
        cls: new () => T extends (infer U)[] ? U : T,
        host: string | undefined,
        path: string,
        cacheKey: string,
        opts?: FetchOptions<T>
    ): Promise<T | null> {

        let cached: T | null = null
        if (opts?.cache !== 'no-cache') {
            const cachedEntry = await this.cache.get<T>(cacheKey)
            if (cachedEntry) {
                if (cachedEntry.data) {
                    Object.setPrototypeOf(cachedEntry.data, cls.prototype)
                    opts?.expressGetter?.(cachedEntry.data)
                }

                const age = Date.now() - cachedEntry.timestamp
                if (age > (cachedEntry.data ? (opts?.TTL ?? Infinity) : this.negativeCacheTTL)) {
                    this.cache.invalidate(cacheKey)
                } else {
                    cached = cachedEntry.data
                    if (!(opts?.cache === 'swr' || (opts?.cache === 'best-effort' && !cachedEntry.data))) return cachedEntry.data
                }
            }
        }
        if (opts?.cache === 'force-cache') throw new Error('cache not found')

        const fetchNetwork = async (): Promise<T> => {
            const fetchHost = host || this.defaultHost
            const url = `https://${fetchHost}${path}`

            if (!(await this.isHostOnline(fetchHost))) {
                return Promise.reject(new DomainOfflineError(fetchHost))
            }

            if (this.inFlightRequests.has(cacheKey)) {
                return this.inFlightRequests.get(cacheKey)
            }

            let authHeaders = {}
            if (opts?.auth !== 'no-auth') {
                authHeaders = await this.authProvider.getHeaders(fetchHost)
            }

            const requestOptions = {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    ...authHeaders
                }
            }
            
            const req = fetchWithTimeout(url, requestOptions, opts?.timeoutms).then(async (res) => {

                if ([502, 503, 504].includes(res.status)) {
                    await this.markHostOffline(fetchHost)
                    return await Promise.reject(new DomainOfflineError(fetchHost))
                }

                if (!res.ok) {
                    if (res.status === 404) {
                        this.cache.set(cacheKey, null)
                        return null
                    }
                    return await Promise.reject(new Error(`fetch failed on transport: ${res.status} ${await res.text()}`))
                }

                this.markHostOnline(fetchHost)

                const data: ApiResponse<T> = await res.json()
                if (data.status != 'ok') {
                    return await Promise.reject(new Error(`getMessage failed on application: ${data.error}`))
                }
                
                opts?.expressGetter?.(data.content)
                this.cache.set(cacheKey, data.content)

                if (Array.isArray(data.content)) {
                    return data.content.map((item) => Object.setPrototypeOf(item, cls.prototype))
                } else {
                    return Object.setPrototypeOf(data.content, cls.prototype)
                }

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

    // GET:/api/v1/entity/:ccid
    async getEntity(ccid: string, host?: string, opts?: FetchOptions<Entity>): Promise<Entity> {
        const cacheKey = `entity:${ccid}`
        const path = `${apiPath}/entity/${ccid}`
        const data = await this.fetchWithCache(Entity, host ?? this.defaultHost, path, cacheKey, opts)
        if (!data) throw new NotFoundError(`entity ${ccid} not found`)
        return data
    }

    async getEntities(): Promise<Entity[]> {
        const requestPath = `${apiPath}/entities`
        return await this.fetchWithCredential<Entity[]>(this.defaultHost, requestPath) ?? []
    }

    async resolveDomain(ccid: string, hint?: string): Promise<string> {

        if (IsCSID(ccid)) {
            const domain = await this.getDomainByCSID(ccid, { cache: 'best-effort' })
            return domain.fqdn
        } else {
            const entity = await this.getEntity(ccid, hint, { cache: 'best-effort' })
            return entity.domain
        }

    }

    invalidateEntity(ccid: string) {
        this.cache.invalidate(`entity:${ccid}`)
    }

    // GET:/api/v1/message/:id
    async getMessage<T>(id: string, host: string = '', opts?: FetchOptions<Message<T>>): Promise<Message<T>> {
        const cacheKey = `message:${id}`
        const path = `${apiPath}/message/${id}`
        const message =  await this.fetchWithCache(Message, host, path, cacheKey, opts)
        if (!message) throw new NotFoundError(`message ${id} not found`)

        message.ownAssociations = message.ownAssociations?.map((item) => Object.setPrototypeOf(item, Association.prototype)) ?? []
        message.associations = message.associations?.map((item) => Object.setPrototypeOf(item, Association.prototype)) ?? []

        return message
    }

    invalidateMessage(id: string) {
        this.cache.invalidate(`message:${id}`)
    }

    async getMessageWithAuthor(messageId: string, author: string, hint?: string): Promise<Message<any>> {
        const host = await this.resolveDomain(author, hint)
        if (!host) throw new Error('domain not found')

        return await this.getMessage(messageId, host)
    }

    // GET:/api/v1/message/:id/associationcounts
    async getMessageAssociationCountsByTarget(target: string, targetAuthor: string, groupby: {schema?: string} = {}): Promise<Record<string, number>> {
        let requestPath = `${apiPath}/message/${target}/associationcounts`
        if (groupby.schema) requestPath += `?schema=${encodeURIComponent(groupby.schema)}`

        const host = await this.resolveDomain(targetAuthor)
        if (!host) throw new Error('domain not found')

        return await this.fetchWithCredential<Record<string, number>>(host, requestPath) ?? {}
    }

    // GET:/api/v1/message/:id/associations
    async getMessageAssociations<T>(id: string, host: string = ''): Promise<Association<T>[]> {
        const path = `${apiPath}/message/${id}/associations`
        const data = await this.fetchWithCredential<Association<T>[]>(host, path) ?? []
        return data.map((item) => Object.setPrototypeOf(item, Association.prototype))
    }

    // GET:/api/v1/message/:id/associations
    async getMessageAssociationsWithAuthor<T>(id: string, author: string): Promise<Association<T>[]> {
        const host = (await this.resolveDomain(author)) ?? this.defaultHost
        return await this.getMessageAssociations(id, host)
    }


    async getMessageAssociationsByTarget<T>(target: string, targetAuthor: string, filter: {schema?: string, variant?: string} = {}): Promise<Association<T>[]> {
        let requestPath = `${apiPath}/message/${target}/associations`
        if (filter.schema) requestPath += `?schema=${encodeURIComponent(filter.schema)}`
        if (filter.variant) requestPath += `&variant=${encodeURIComponent(filter.variant)}`

        const host = await this.resolveDomain(targetAuthor)
        if (!host) throw new Error('domain not found')

        const data = await this.fetchWithCredential<Association<T>[]>(host, requestPath) ?? []
        return data.map((item) => Object.setPrototypeOf(item, Association.prototype))
    }

    async getAssociation<T>(id: string, host?: string, opts?: FetchOptions<Association<T>>): Promise<Association<T>> {
        const cacheKey = `association:${id}`
        const path = `${apiPath}/association/${id}`
        const data = await this.fetchWithCache<Association<T>>(Association, host, path, cacheKey, opts)
        if (!data) throw new NotFoundError(`association ${id} not found`)
        return data
    }

    invalidateAssociation(id: string) {
        this.cache.invalidate(`association:${id}`)
    }

    async getAssociationWithOwner<T>(id: string, owner: string): Promise<Association<T>> {
        const host = (await this.resolveDomain(owner)) ?? this.defaultHost
        return await this.getAssociation(id, host)
    }

    // GET:/api/v1/profile/:id
    async getProfile<T>(id: string, host?: string, opts?: FetchOptions<Profile<T>>): Promise<Profile<T>> {
        const cacheKey = `profile:${id}`
        const path = `${apiPath}/profile/${id}`
        const data = await this.fetchWithCache<Profile<T>>(Profile, host, path, cacheKey, opts)
        if (!data) throw new NotFoundError(`profile ${id} not found`)
        return data
    }

    invalidateProfile(id: string) {
        this.cache.invalidate(`profile:${id}`)
    }

    async getProfileBySemanticID<T>(semanticID: string, owner: string, opts?: FetchOptions<Profile<T>>): Promise<Profile<T>> {
        const cacheKey = `profile:${semanticID}@${owner}`
        const path = `${apiPath}/profile/${owner}/${semanticID}`

        const host = (await this.resolveDomain(owner)) ?? this.defaultHost
        const data = await this.fetchWithCache<Profile<T>>(Profile, host, path, cacheKey, opts)
        if (!data) throw new NotFoundError(`profile ${semanticID}@${owner} not found`)
        return data
    }

    async getProfiles<T>(query: {author?: string, schema?: string, since?: number, until?: number, limit?: number, domain?: string}): Promise<Profile<T>[]> {

        let requestPath = `${apiPath}/profiles?`

        let queries: string[] = []
        if (query.author) queries.push(`author=${query.author}`)
        if (query.schema) queries.push(`schema=${encodeURIComponent(query.schema)}`)
        if (query.since) queries.push(`since=${query.since}`)
        if (query.until) queries.push(`until=${query.until}`)
        if (query.limit) queries.push(`limit=${query.limit}`)

        requestPath += queries.join('&')

        const targetHost = query.domain ?? (query.author && await this.resolveDomain(query.author)) ?? this.defaultHost

        const results = await this.fetchWithCredential<Profile<T>[]>(targetHost, requestPath)
        return results.map((item) => Object.setPrototypeOf(item, Profile.prototype))
    }

    async resolveTimelineHost(timeline: string): Promise<string> {
        const split = timeline.split('@')
        let host = split[1] ?? this.defaultHost

        if (IsCCID(host) || IsCSID(host)) {
            const domain = await this.resolveDomain(host)
            if (!domain) throw new Error('domain not found: ' + host)
            host = domain
        }

        return host
    }

    async getTimelineListBySchema<T>(schema: string, remote?: string): Promise<Timeline<T>[]> {
        const requestPath = `${apiPath}/timelines?schema=${encodeURIComponent(schema)}`
        const host = remote ?? this.defaultHost
        return await this.fetchWithCredential<Timeline<T>[]>(host, requestPath) ?? []
    }

    async getTimeline<T>(id: string, opts?: FetchOptions<Timeline<T>>): Promise<Timeline<T>> {
        const cacheKey = `timeline:${id}`
        const path = `${apiPath}/timeline/${id}`
        const host = await this.resolveTimelineHost(id)
        const data = await this.fetchWithCache<Timeline<T>>(Timeline, host, path, cacheKey, opts) // 5 minutes
        if (!data) throw new NotFoundError(`timeline ${id} not found`)
        return data
    }

    invalidateTimeline(id: string) {
        this.cache.invalidate(`timeline:${id}`)
    }

    async getTimelineRecent(timelines: string[]): Promise<TimelineItem[]> {
        const requestPath = `${apiPath}/timelines/recent?timelines=${timelines.join(',')}`
        const data = await this.fetchWithCredential<TimelineItem[]>(this.defaultHost, requestPath) ?? []
        return data.map((item) => Object.setPrototypeOf(item, TimelineItem.prototype))
    }


    async queryTimeline(timeline: string, query: {schema?: string, owner?: string, author?: string }, until?: Date, limit?: number): Promise<TimelineItem[]> {

        const host = await this.resolveTimelineHost(timeline)
        const basePath = `${apiPath}/timeline/${timeline}/query?`
        const queries: string[] = []
        if (query.schema) queries.push(`schema=${query.schema}`)
        if (query.owner) queries.push(`owner=${query.owner}`)
        if (query.author) queries.push(`author=${query.author}`)
        if (until) queries.push(`until=${Math.ceil(until.getTime()/1000)}`)
        if (limit) queries.push(`limit=${limit}`)

        const requestPath = basePath + queries.join('&')
        const data = await this.fetchWithCredential<TimelineItem[]>(host, requestPath) ?? []
        return data.map(item => Object.setPrototypeOf(item, TimelineItem.prototype))
    }

    async getTimelineRanged(timelines: string[], param: {until?: Date, since?: Date}): Promise<TimelineItem[]> {

        const sinceQuery = !param.since ? '' : `&since=${Math.floor(param.since.getTime()/1000)}`
        const untilQuery = !param.until ? '' : `&until=${Math.ceil(param.until.getTime()/1000)}`

        const requestPath = `${apiPath}/timelines/range?timelines=${timelines.join(',')}${sinceQuery}${untilQuery}`
        const data = await this.fetchWithCredential<TimelineItem[]>(this.defaultHost, requestPath) ?? []
        return data.map(item => Object.setPrototypeOf(item, TimelineItem.prototype))

    }

    async getTimelineAssociations(id: string): Promise<Association<any>[]> {

        const host = await this.resolveTimelineHost(id)

        const requestPath = `${apiPath}/timeline/${id}/associations`
        return await this.fetchWithCredential<Association<any>[]>(host, requestPath) ?? []
    }

    async getSubscription<T>(id: string, opts?: FetchOptions<Subscription<T>>): Promise<Subscription<T>> {
        const cacheKey = `subscription:${id}`
        const path = `${apiPath}/subscription/${id}`
        const data = await this.fetchWithCache<Subscription<T>>(Subscription, this.defaultHost, path, cacheKey, opts)
        if (!data) throw new NotFoundError(`subscription ${id} not found`)
        return data
    }

    async getOwnSubscriptions<T>(): Promise<Subscription<T>[]> {
        const requestPath = `${apiPath}/subscriptions/mine`
        const data =  await this.fetchWithCredential<Subscription<T>[]>(this.defaultHost, requestPath)
        return data.map((item) => Object.setPrototypeOf(item, Subscription.prototype))
    }

    invalidateSubscription(id: string) {
        this.cache.invalidate(`subscription:${id}`)
    }

    async getDomain(remote: string, opts?: FetchOptions<Domain>): Promise<Domain> {
        const cacheKey = `domain:${remote}`
        const path = `${apiPath}/domain`
        const data = await this.fetchWithCache<Domain>(Domain, remote, path, cacheKey, { ...opts, auth: 'no-auth' })
        if (!data) throw new NotFoundError(`domain ${remote} not found`)
        return data
    }

    async getDomainByCSID(csid: string, opts?: FetchOptions<Domain>): Promise<Domain> {
        const cacheKey = `domain:${csid}`
        const path = `${apiPath}/domain/${csid}`
        const data = await this.fetchWithCache<Domain>(Domain, this.defaultHost, path, cacheKey, { ...opts, auth: 'no-auth' })
        if (!data) throw new NotFoundError(`domain ${csid} not found`)
        return data
    }

    invalidateDomain(remote: string) {
        this.cache.invalidate(`domain:${remote}`)
    }

    async getDomains(): Promise<Domain[]> {
        const requestPath = `${apiPath}/domains`
        return await this.fetchWithCredential<Domain[]>(this.defaultHost, requestPath) ?? []
    }

    async getAcking(ccid: string): Promise<Ack[]> {
        const host = (await this.resolveDomain(ccid)) ?? this.defaultHost
        const requestPath = `${apiPath}/entity/${ccid}/acking`
        return await this.fetchWithCredential<Ack[]>(host, requestPath) ?? []
    }

    async getAcker(ccid: string): Promise<Ack[]> {
        const host = (await this.resolveDomain(ccid)) ?? this.defaultHost
        const requestPath = `${apiPath}/entity/${ccid}/acker`
        return await this.fetchWithCredential<Ack[]>(host, requestPath) ?? []
    }

    async getKeyList(): Promise<Key[]> {
        const requestPath = `${apiPath}/keys/mine`
        return await this.fetchWithCredential<Key[]>(this.defaultHost, requestPath) ?? []
    }

    async getKeyResolution(ckid: CKID, owner: CCID): Promise<Key[]> {
        const host = (await this.resolveDomain(owner)) ?? this.defaultHost
        const requestPath = `${apiPath}/key/${ckid}`
        return await this.fetchWithCredential<Key[]>(host, requestPath) ?? []
    }

    // Posts
    async commit<T>(obj: any, host: string = ''): Promise<T> {

        const ccid = this.authProvider.getCCID()
        const ckid = this.authProvider.getCKID()

        obj.signer = ccid
        if (ckid) obj.keyID = ckid

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

        return await fetch(`https://${host || this.defaultHost}${apiPath}/commit`, requestOptions)
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
    ): Promise<Message<T>> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Message<T> = {
            signer: ccid,
            type: 'message',
            schema,
            body,
            timelines,
            signedAt: new Date(),
            policy,
            policyParams,
            policyDefaults
        }

        return await this.commit<Message<T>>(documentObj)
    }

    async createAssociation<T>(
        schema: Schema,
        body: T,
        target: string,
        targetAuthor: CCID,
        timelines: TimelineID[],
        variant: string = ''
    ): Promise<Association<T>> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Association<T> = {
            signer: ccid,
            type: 'association',
            schema,
            body,
            target,
            owner: targetAuthor,
            timelines,
            variant,
            signedAt: new Date()
        }

        return await this.commit<Association<T>>(documentObj)
    }

    async upsertProfile<T>(
        schema: Schema,
        body: T,
        {id = undefined, semanticID = undefined, policy = undefined, policyParams = undefined }: {id?: string, semanticID?: string, policy?: string, policyParams?: string}
    ): Promise<Profile<T>> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Profile<T> = {
            id: id,
            semanticID: semanticID,
            signer: ccid,
            type: 'profile',
            schema,
            body,
            signedAt: new Date(),
            policy,
            policyParams,
        }

        const ret = await this.commit<Profile<T>>(documentObj)
        this.invalidateProfile(ret.id)
        return ret
    }

    async upsertTimeline<T>(
        schema: string,
        body: T,
        { id = undefined, semanticID = undefined, owner = undefined, indexable = true, policy = undefined, policyParams = undefined }: { id?: string, semanticID?: string, owner?: string, indexable?: boolean, policy?: string, policyParams?: string } = {}
    ): Promise<Timeline<T>> {

        const ccid = this.authProvider.getCCID()

        let host = this.defaultHost
        if (id && id.includes('@')) {
            try {
                host = await this.resolveTimelineHost(id)
            } catch (e) {
                return Promise.reject(e)
            }
        }

        const normalizedID = id?.split('@')[0]

        const documentObj: CCDocument.Timeline<T> = {
            id: normalizedID,
            owner: owner ?? ccid,
            signer: ccid,
            type: 'timeline',
            schema,
            body,
            signedAt: new Date(),
            indexable,
            semanticID,
            policy,
            policyParams,
        }

        const ret = await this.commit<Timeline<T>>(documentObj, host)
        this.invalidateTimeline(ret.id)
        return ret
    }

    async retractItem(timeline: string, item: string): Promise<any> {
        const host = (await this.resolveTimelineHost(timeline)) ?? this.defaultHost
        const ccid = this.authProvider.getCCID()

        const document: CCDocument.Retract = {
            signer: ccid,
            type: 'retract',
            target: item,
            timeline: timeline,
            signedAt: new Date()
        }

        return await this.commit(document, host)
    }


    async upsertSubscription<T>(
        schema: string,
        body: T,
        { id = undefined, semanticID = undefined, owner = undefined, indexable = true, policy = undefined, policyParams = undefined }: { id?: string, semanticID?: string, owner?: string, indexable?: boolean, policy?: string, policyParams?: string } = {}
    ): Promise<Subscription<T>> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Subscription<T> = {
            id: id,
            owner: owner ?? ccid,
            signer: ccid,
            type: 'subscription',
            schema,
            body,
            signedAt: new Date(),
            indexable,
            semanticID,
            policy,
            policyParams
        }

        const ret = await this.commit<Subscription<T>>(documentObj)
        this.invalidateSubscription(ret.id)
        return ret
    }

    async subscribe(target: string, subscription: string): Promise<any> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Subscribe = {
            signer: ccid,
            type: 'subscribe',
            target,
            subscription,
            signedAt: new Date()
        }
        const ret = await this.commit(documentObj)
        this.invalidateSubscription(subscription)
        return ret
    }

    async unsubscribe(target: string, subscription: string): Promise<any> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Unsubscribe = {
            signer: ccid,
            type: 'unsubscribe',
            target,
            subscription,
            signedAt: new Date()
        }
        const ret = await this.commit(documentObj)
        this.invalidateSubscription(subscription)
        return ret
    }


    async ack(target: string): Promise<any> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Ack = {
            type: 'ack',
            signer: ccid,
            from: ccid,
            to: target,
            signedAt: new Date()
        }

        return await this.commit(documentObj)
    }

    async unack(target: string): Promise<any> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Unack = {
            type: 'unack',
            signer: ccid,
            from: ccid,
            to: target,
            signedAt: new Date()
        }

        return await this.commit(documentObj)
    }

    async enactSubkey(subkey: string): Promise<void> {

        const ccid = this.authProvider.getCCID()
        const ckid = this.authProvider.getCKID()

        const documentObj: CCDocument.Enact = {
            type: 'enact',
            signer: ccid,
            target: subkey,
            root: ccid,
            parent: ckid ?? ccid,
            signedAt: new Date()
        }

        return await this.commit(documentObj)
    }

    async revokeSubkey(subkey: string): Promise<void> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Revoke = {
            type: 'revoke',
            signer: ccid,
            target: subkey,
            signedAt: new Date()
        }

        return await this.commit(documentObj)
    }

    // Delete
    async deleteMessage(target: string, host: string = ''): Promise<any> {
        const targetHost = host || this.defaultHost
        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Delete = {
            type: 'delete',
            signer: ccid,
            target,
            signedAt: new Date()
        }

        return await this.commit(documentObj, targetHost)
    }

    async deleteAssociation(
        target: string,
        targetAuthor: CCID
    ): Promise<any> {
        const ccid = this.authProvider.getCCID()
        const targetHost = (await this.resolveDomain(targetAuthor)) ?? this.defaultHost

        const documentObj: CCDocument.Delete = {
            type: 'delete',
            signer: ccid,
            target,
            signedAt: new Date()
        }

        return await this.commit(documentObj, targetHost)
    }

    async deleteProfile(id: string): Promise<any> {

        const ccid = this.authProvider.getCCID()

        const documentObj: CCDocument.Delete = {
            type: 'delete',
            signer: ccid,
            target: id,
            signedAt: new Date()
        }

        return await this.commit(documentObj)
    }

    async deleteTimeline(target: string, host: string = ''): Promise<any> {

        const ccid = this.authProvider.getCCID()
        const targetHost = host || this.defaultHost

        const documentObj: CCDocument.Delete = {
            type: 'delete',
            signer: ccid,
            target,
            signedAt: new Date()
        }

        return await this.commit(documentObj, targetHost)
    }

    async deleteSubscription(id: string): Promise<any> {

        const documentObj: CCDocument.Delete = {
            type: 'delete',
            signer: this.authProvider.getCCID(),
            target: id,
            signedAt: new Date()
        }

        return await this.commit(documentObj)
    }

    // Other
    async register(document: string, signature: string, info: any = {}, invitation?: string, captcha?: string): Promise<Response> {

        const optionObj = {
            info: JSON.stringify(info),
            invitation,
            document,
        }

        const option = JSON.stringify(optionObj)

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }

        if (captcha) {
            headers['captcha'] = captcha
        }

        const body = JSON.stringify({
            document,
            signature,
            option
        })

        const requestOptions = {
            method: 'POST',
            headers,
            body
        }

        return await fetch(`https://${this.defaultHost}/api/v1/commit`, requestOptions)
    }

    async getKV(key: string): Promise<string | null | undefined> {
        return await this.fetchWithCredential(this.defaultHost, `${apiPath}/kv/${key}`, {
            method: 'GET',
        })
    }

    async writeKV(key: string, value: string): Promise<void> {
        await this.fetchWithCredential(this.defaultHost, `${apiPath}/kv/${key}`, {
            method: 'PUT',
            body: value
        })
    }
}

