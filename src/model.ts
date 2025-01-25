
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

export type TimelineID    = string
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
    schema: string = ''
    document: string = ''
    signature: string = ''
    target: MessageID = ''
    cdate: string = ''

    getDocument(): CCDocument.Association<T> {
        return JSON.parse(this.document)
    }
}
    

