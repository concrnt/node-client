import { LoadKey } from "../crypto";
import { ComputeCCID } from "../crypto";
import { LoadSubKey } from "../crypto";
import { CheckJwtIsValid } from "../crypto";
import { IssueJWT } from "../crypto";

export interface AuthProvider {
    getCCID: () => string;
    getHeaders: (domain: string) => Promise<Record<string, string>>;
    getPassport: () => Promise<string>;
}


export class MasterKeyAuthProvider implements AuthProvider {

    privatekey: string
    host: string

    ccid: string

    passport?: string
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

    async getPassport(): Promise<string> {

        return await fetch(`https://${this.host}/api/v1/auth/passport`, {
            method: 'GET',
            headers: {}
        })
            .then(async (res) => await res.json())
            .then((data) => {
                this.passport = data.content
                return data.content
            })
    }

    async getHeaders(domain: string) {

        let credential = this.tokens[domain]
        if (!credential || !CheckJwtIsValid(credential)) {
            if (this.privatekey) credential = this.generateApiToken(domain)
        }

        let passport = this.passport
        if (!passport) {
            passport = await this.getPassport()
        }

        return {
            authorization: `Bearer ${credential}`,
            passport: passport
        };
    }

    getCCID() {
        return this.ccid
    }
}

export class SubKeyAuthProvider implements AuthProvider {

    privatekey: string
    host: string

    ccid: string
    ckid: string

    passport?: string
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
            iss: this.ccid,
            sub: 'concrnt',
        })

        this.tokens[remote] = token

        return token
    }

    async getPassport(): Promise<string> {

        return await fetch(`https://${this.host}/api/v1/auth/passport`, {
            method: 'GET',
            headers: {}
        })
            .then(async (res) => await res.json())
            .then((data) => {
                this.passport = data.content
                return data.content
            })
    }

    async getHeaders(domain: string) {

        let credential = this.tokens[domain]
        if (!credential || !CheckJwtIsValid(credential)) {
            if (this.privatekey) credential = this.generateApiToken(domain)
        }

        let passport = this.passport
        if (!passport) {
            passport = await this.getPassport()
        }

        return {
            authorization: `Bearer ${credential}`,
            passport: passport
        };
    }

    getCCID() {
        return this.ccid
    }


}

export class GuestAuthProvider implements AuthProvider {
    
    constructor() {}

    async getHeaders(_domain: string) {
        return {};
    }

    getCCID(): never {
        throw new Error("Method not implemented.");
    }

    getPassport(): never {
        throw new Error("Method not implemented.");
    }
}


