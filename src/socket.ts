import { Api } from './api';
import { Association, CCDocument, Message, TimelineEvent, TimelineID } from './model';

const WS = typeof window === 'undefined' ? require('ws') : window.WebSocket;


export class Socket {

    api: Api
    ws: any;
    subscriptions: Map<string, Set<(event: TimelineEvent) => void>> = new Map()

    failcount = 0
    reconnecting = false

    hostOverride?: string;

    constructor(api: Api, hostOverride?: string) {
        this.api = api
        this.hostOverride = hostOverride

        this.connect()
        setInterval(() => {
            this.checkConnection()
        }, 1000)
        setInterval(() => {
            this.heartbeat()
        }, 30000)
    }

    connect() {
        this.ws = new WS('wss://' + (this.hostOverride ?? this.api.defaultHost) + '/api/v1/timelines/realtime');

        this.ws.onmessage = async (rawevent: any) => {

            const event: TimelineEvent = JSON.parse(rawevent.data);
            Object.setPrototypeOf(event, TimelineEvent.prototype)

            const document = event.parsedDoc
            if (document) {
                switch (document.type) {
                    case 'message':
                        if (event.resource) {
                            const message: Message<any> = event.resource as Message<any>
                            Object.setPrototypeOf(message, Message.prototype)
                            message.ownAssociations = []

                            await this.api.cache.set(`message:${message.id}`, message)
                        }
                    break
                    case 'association':
                        const association = document as CCDocument.Association<any>
                        this.api.invalidateMessage(association.target)
                    break
                    case 'delete':
                        const deletion = document as CCDocument.Delete
                        switch (deletion.target[0]) {
                            case 'm':
                                this.api.invalidateMessage(deletion.target)
                            break
                            case 'a':
                                const resource = event.resource as Association<any>
                                if (resource.target) {
                                    this.api.invalidateMessage(resource.target)
                                }
                            break
                        }
                    break
                    default:
                    console.info('unknown event document type', event)
                }
            }

            this.distribute(event.timeline, event)
        }

        this.ws.onerror = (event: any) => {
            console.info('socket error', event)
        }

        this.ws.onclose = (event: any) => {
            console.info('socket close', event)
        }

        this.ws.onopen = (event: any) => {
            console.info('socket open', event)
            this.ws.send(JSON.stringify({ type: 'listen', channels: Array.from(this.subscriptions.keys()) }))
        }
    }

    heartbeat() {
        this.ws.send(JSON.stringify({ type: 'h' }))
    }

    checkConnection() {
        if (this.ws.readyState !== WS.OPEN && !this.reconnecting) {
            this.failcount = 0
            this.reconnecting = true
            this.reconnect()
        }
    }

    reconnect() {
        if (this.ws.readyState === WS.OPEN) {
            console.info('reconnect confirmed')
            this.reconnecting = false
            this.failcount = 0
        } else {
            console.info('reconnecting. attempt: ', this.failcount)
            this.connect()
            this.failcount++
            setTimeout(() => {
                this.reconnect()
            }, 500 * Math.pow(1.5, Math.min(this.failcount, 15)))
        }
    }

    distribute(timelineID: string, event: TimelineEvent) {
        if (this.subscriptions.has(timelineID)) {
            this.subscriptions.get(timelineID)?.forEach(callback => {
                callback(event)
            })
        }
    }

    listen(timelines: TimelineID[], callback: (event: TimelineEvent) => void) {
        const currenttimelines = Array.from(this.subscriptions.keys())
        timelines.forEach(topic => {
            if (!this.subscriptions.has(topic)) {
                this.subscriptions.set(topic, new Set())
            }
            this.subscriptions.get(topic)?.add(callback)
        })
        const newtimelines = Array.from(this.subscriptions.keys())
        if (newtimelines.length > currenttimelines.length) {
            this.ws.send(JSON.stringify({ type: 'listen', channels: newtimelines }))
        }
    }

    unlisten(timelines: TimelineID[], callback: (event: TimelineEvent) => void) {
        const currenttimelines = Array.from(this.subscriptions.keys())
        timelines.forEach(topic => {
            if (this.subscriptions.has(topic)) {
                this.subscriptions.get(topic)?.delete(callback)

                if (this.subscriptions.get(topic)?.size === 0) {
                    this.subscriptions.delete(topic)
                }
            }
        })
        const newtimelines = Array.from(this.subscriptions.keys())
        if (newtimelines.length < currenttimelines.length) {
            this.ws.send(JSON.stringify({ type: 'unlisten', channels: newtimelines }))
        }
    }

    ping() {
        this.ws.send(JSON.stringify({ type: 'ping' }))
    }

    waitOpen() {
        return new Promise((resolve, reject) => {
            const maxNumberOfAttempts = 10
            const intervalTime = 200 //ms

            let currentAttempt = 0
            const interval = setInterval(() => {
                if (currentAttempt > maxNumberOfAttempts - 1) {
                    clearInterval(interval)
                    reject(new Error('Maximum number of attempts exceeded'))
                } else if (this.ws.readyState === WS.OPEN) {
                    clearInterval(interval)
                    resolve(true)
                }
                currentAttempt++
            }, intervalTime)
        })
    }
}

