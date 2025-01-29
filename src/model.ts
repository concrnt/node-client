
// -- core --
export type FQDN = string

export type CCID = string
export const IsCCID = (str: string): boolean => {
    return str.startsWith('con1') && !str.includes('.') && str.length === 42
}

export type CSID = string
export const IsCSID = (str: string): boolean => {
    return str.startsWith('ccs1') && !str.includes('.') && str.length === 42
}

export type CKID = string
export const IsCKID = (str: string): boolean => {
    return str.startsWith('cck1') && !str.includes('.') && str.length === 42
}

export type Schema = string

export type TimelineID    = string
export type SubscriptionID = string
export type MessageID     = string
export type AssociationID = string
export type ProfileID     = string

// -- document --
interface DocumentBase<S> {
    id?: string
    signer: string
    type: S
    keyID?: string
    meta?: any
    semanticID?: string
    signedAt: Date
    policy?: string
    policyParams?: string
    policyDefaults?: string
}

interface DocumentBaseWithBody<T, S> extends DocumentBase<S> {
    schema: string
    body: T
}

type Document<T, S> = DocumentBase<S> | DocumentBaseWithBody<T, S>


interface AffiliationDocument extends DocumentBase<'affiliation'> {
    domain: string
}

interface MessageDocument<T> extends DocumentBaseWithBody<T, 'message'> {
    timelines: string[]
}

interface AssociationDocument<T> extends DocumentBaseWithBody<T, 'association'> {
    target: string
    owner: string
    variant: string
    timelines: string[]
}

type ProfileDocument<T> = DocumentBaseWithBody<T, 'profile'>

interface DeleteDocument extends DocumentBase<'delete'> {
    target: string
}

interface TimelineDocument<T> extends DocumentBaseWithBody<T, 'timeline'> {
    owner: string
    indexable: boolean
}

interface AckDocument extends DocumentBase<'ack'> {
    from: CCID
    to: CCID
}

interface UnackDocument extends DocumentBase<'unack'> {
    from: CCID
    to: CCID
}

interface EnactDocument extends DocumentBase<'enact'> {
    target: string
    root: string
    parent: string
}

interface RevokeDocument extends DocumentBase<'revoke'> {
    target: string
}

interface SubscriptionDocument<T> extends DocumentBaseWithBody<T, 'subscription'> {
    owner: string
    indexable: boolean
}

interface SubscribeDocument extends DocumentBase<'subscribe'> {
    target: string
    subscription: string
}

interface UnsubscribeDocument extends DocumentBase<'unsubscribe'> {
    target: string
    subscription: string
}

interface RetractDocument extends DocumentBase<'retract'> {
    timeline: string
    target: string
}

export namespace CCDocument {
    export type Base<T, S> = Document<T, S>
    export type Affiliation = AffiliationDocument
    export type Message<T> = MessageDocument<T>
    export type Profile<T> = ProfileDocument<T>
    export type Association<T> = AssociationDocument<T>
    export type Timeline<T> = TimelineDocument<T>
    export type Delete = DeleteDocument
    export type Ack = AckDocument
    export type Unack = UnackDocument
    export type Enact = EnactDocument
    export type Revoke = RevokeDocument
    export type Subscription<T> = SubscriptionDocument<T>
    export type Subscribe = SubscribeDocument
    export type Unsubscribe = UnsubscribeDocument
    export type Retract = RetractDocument
}

// -- core --

export class Entity {
    ccid: CCID = ''
    alias?: string
    tag: string = ''
    domain: FQDN = ''
    cdate: string = ''
    score: number = 0

    affiliationDocument: string = ''
    affiliationSignature: string = ''

    tombstoneDocument?: string
    tombstoneSignature?: string

    getAffiliationDocument(): CCDocument.Affiliation {
        return JSON.parse(this.affiliationDocument)
    }

    getTombstoneDocument(): CCDocument.Delete | undefined {
        if (!this.tombstoneDocument) return undefined
        return JSON.parse(this.tombstoneDocument)
    }
}

export class Message<T> {
    id: MessageID = ''
    author: CCID = ''
    schema: string = ''
    document: string = ''
    signature: string = ''
    timelines: TimelineID[] = []
    policy?: string = ''
    policyParams?: string = ''
    associations: Association<any>[] = []
    ownAssociations: Association<any>[] = []
    cdate: string = ''

    getDocument(): CCDocument.Message<T> {
        return JSON.parse(this.document)
    }
}

export class Association<T> {
    id: AssociationID = ''
    author: CCID = ''
    owner: CCID | CSID = ''
    schema: string = ''
    document: string = ''
    signature: string = ''
    target: MessageID = ''
    cdate: string = ''

    getDocument(): CCDocument.Association<T> {
        return JSON.parse(this.document)
    }
}

export class Timeline<T> {
    id: TimelineID = ''
    indexable: boolean = false
    owner: CCID | CSID = ''
    author: CCID = ''
    schema: string = ''
    policy?: string
    policyParams?: string
    document: string = ''
    signature: string = ''
    cdate: string = ''
    mdate: string = ''

    getDocument(): CCDocument.Timeline<T> {
        return JSON.parse(this.document)
    }
}

export class TimelineItem {
    resourceID: string = ''
    timelineID: string = ''
    author: string = ''
    owner: string = ''
    cdate: string = ''
}

export class Profile<T> {
    id: ProfileID = ''
    author: CCID = ''
    schema: string = ''
    document: string = ''
    signature: string = ''
    cdate: string = ''

    associations: Association<any>[] = []

    getDocument(): CCDocument.Profile<T> {
        return JSON.parse(this.document)
    }
}

export class Subscription<T> {
    id: string = ''
    author: CCID = ''
    owner: CCID | CSID = ''
    indexable: boolean = false
    schema: string = ''
    policy?: string
    policyParams?: string
    document: string = ''
    signature: string = ''
    items: SubscriptionItem[] = []
    cdate: string = ''
    mdate: string = ''

    getDocument(): CCDocument.Subscription<T> {
        return JSON.parse(this.document)
    }
}

export enum ResolverType {
    Entity = 0,
    Domain = 1,
}

export class SubscriptionItem {
    id: string = ''
    resolverType: ResolverType = ResolverType.Entity
    entity: string = ''
    domain: string = ''
    subscription: string = ''
}

export class Ack {
    from: CCID = ''
    to: CCID = ''
    document: string = ''
    signature: string = ''

    getDocument(): CCDocument.Ack {
        return JSON.parse(this.document)
    }
}

export class Domain {
    fqdn: FQDN = ''
    csid: CSID = ''
    tag: string = ''
    pubkey: string = ''
    cdate: string = ''
    score: number = 0
    meta: Record<string, any> = {}
}

export class Key {
    id: CKID = ''
    root: CCID = ''
    parent: CKID | CCID = ''
    enactDocument: string = ''
    enactSignature: string = ''
    revokeDocument?: string
    revokeSignature?: string
    validSince: string = ''
    validUntil: string = ''

    getEnactDocument(): CCDocument.Enact {
        return JSON.parse(this.enactDocument)
    }

    getRevokeDocument(): CCDocument.Revoke | undefined {
        if (!this.revokeDocument) return undefined
        return JSON.parse(this.revokeDocument)
    }
}


