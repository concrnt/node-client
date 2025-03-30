import { JwtPayload, LoadKey, Sign } from "../crypto";
import { ComputeCCID } from "../crypto";
import { LoadSubKey } from "../crypto";
import { CheckJwtIsValid } from "../crypto";
import { IssueJWT } from "../crypto";

export interface AuthProvider {
    getCCID: () => string;
    getCKID: () => string | undefined;
    getHeaders: (domain: string) => Promise<Record<string, string>>;
    getAuthToken: (domain: string) => string;
    getPassport: () => Promise<string>;
    getHost: () => string;

    sign(data: string): string;
    issueJWT: (claims: JwtPayload) => string;
}


export class MasterKeyAuthProvider implements AuthProvider {

    privatekey: string
    host: string

    ccid: string

    passport?: Promise<string>
    tokens: Record<string, string> = {}

    constructor(privatekey: string, host: string) {

        this.privatekey = privatekey
        this.host = host

        const keypair = LoadKey(privatekey)
        if (!keypair) {
            throw new Error('Invalid key')
        }
        this.ccid = ComputeCCID(keypair.publickey)
    }

    generateApiToken(remote: string): string {

        const token = IssueJWT(this.privatekey, {
            aud: remote,
            iss: this.ccid,
            sub: 'concrnt',
        })

        this.tokens[remote] = token

        return token
    }

    getAuthToken(remote: string): string {
        let token = this.tokens[remote]
        if (!token || !CheckJwtIsValid(token)) {
            if (this.privatekey) token = this.generateApiToken(remote)
        }
        return token
    }

    async getPassport(): Promise<string> {

        this.passport = fetch(`https://${this.host}/api/v1/auth/passport`, {
            method: 'GET',
            headers: { authorization: `Bearer ${this.getAuthToken(this.host)}` }
        })
            .then(async (res) => await res.json())
            .then((data) => {
                return data.content
            })

        return this.passport
    }

    async getHeaders(domain: string) {

        let passport = await this.passport
        if (!passport) {
            passport = await this.getPassport()
        }

        return {
            authorization: `Bearer ${this.getAuthToken(domain)}`,
            passport: passport
        };
    }

    getCCID() {
        return this.ccid
    }

    getCKID() {
        return undefined
    }

    getHost() {
        return this.host
    }

    sign(data: string): string {
        return Sign(this.privatekey, data)
    }

    issueJWT(claims: JwtPayload): string {
        claims.iss ??= this.ccid
        return IssueJWT(this.privatekey, claims)
    }
}

export class SubKeyAuthProvider implements AuthProvider {

    privatekey: string
    host: string

    ccid: string
    ckid: string

    passport?: Promise<string>
    tokens: Record<string, string> = {}

    constructor(subkey: string) {

        const parsedKey = LoadSubKey(subkey)
        if (!parsedKey) {
            throw new Error('Invalid key')
        }
        this.host = parsedKey.domain
        this.ccid = parsedKey.ccid
        this.ckid = parsedKey.ckid
        this.privatekey = parsedKey.keypair.privatekey
    }

    generateApiToken(remote: string): string {

        const token = IssueJWT(this.privatekey, {
            aud: remote,
            iss: this.ckid,
            sub: 'concrnt',
        })

        this.tokens[remote] = token

        return token
    }

    getAuthToken(remote: string): string {
        let token = this.tokens[remote]
        if (!token || !CheckJwtIsValid(token)) {
            if (this.privatekey) token = this.generateApiToken(remote)
        }
        return token
    }

    async getPassport(): Promise<string> {

        this.passport = fetch(`https://${this.host}/api/v1/auth/passport`, {
            method: 'GET',
            headers: { authorization: `Bearer ${this.getAuthToken(this.host)}` }
        })
            .then(async (res) => await res.json())
            .then((data) => {
                return data.content
            })

        return this.passport
    }

    async getHeaders(domain: string) {

        let passport = await this.passport
        if (!passport) {
            passport = await this.getPassport()
        }

        return {
            authorization: `Bearer ${this.getAuthToken(domain)}`,
            passport: passport
        };
    }

    getCCID() {
        return this.ccid
    }

    getCKID() {
        return this.ckid
    }

    getHost() {
        return this.host
    }

    sign(data: string): string {
        return Sign(this.privatekey, data)
    }

    issueJWT(claims: JwtPayload): string {
        claims.iss ??= this.ccid
        return IssueJWT(this.privatekey, claims, {keyID: this.ckid})
    }

}

export class GuestAuthProvider implements AuthProvider {

    defaultHost = ''
    
    constructor(defaultHost: string) {
        this.defaultHost = defaultHost
    }

    async getHeaders(_domain: string) {
        return {};
    }

    getAuthToken(_domain: string): string {
        throw new Error("Method not implemented.");
    }

    getCCID(): never {
        throw new Error("Method not implemented.");
    }

    getCKID(): never {
        throw new Error("Method not implemented.");
    }

    getPassport(): never {
        throw new Error("Method not implemented.");
    }

    getHost(): string {
        return this.defaultHost
    }

    sign(_data: string): never {
        throw new Error("Method not implemented.");
    }

    issueJWT(_claims: JwtPayload): never {
        throw new Error("Method not implemented.");
    }
}


