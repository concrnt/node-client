import { CCDocument, TimelineEvent } from './model';
import { Socket } from './socket';

type socketEvent = 'MessageCreated' | 'MessageDeleted' | 'AssociationCreated' | 'AssociationDeleted'

export class SocketListener {

    socket: Socket;
    streams: string[] = [];
    fns: Record<socketEvent, Set<(event: TimelineEvent) => void>>

    on(type: socketEvent, fn: (event: TimelineEvent) => void) {
        if (this.fns[type]) {
            this.fns[type].add(fn)
        } else {
            this.fns[type] = new Set([fn])
        }
    }
    off(type: socketEvent, fn: (event: TimelineEvent) => void) {
        this.fns[type]?.delete(fn)
    }
    emit(type: socketEvent, event: TimelineEvent) {
        for (const fn of this.fns[type] || []) fn(event)
    }

    constructor(socket: Socket) {
        this.fns = {
            MessageCreated: new Set(),
            MessageDeleted: new Set(),
            AssociationCreated: new Set(),
            AssociationDeleted: new Set(),
        }
        this.socket = socket;
    }

    async listen(streams: string[]): Promise<void> {
        this.streams = streams
        await this.socket.waitOpen()
        this.socket.listen(streams, (event: TimelineEvent) => {
            const document = event.parsedDoc
            if (!document) return
            switch (document.type) {
                case 'message':
                    this.emit('MessageCreated', event);
                    break;
                case 'association':
                    this.emit('AssociationCreated', event);
                    break;
                case 'delete':
                    const deleteDoc = document as CCDocument.Delete
                    switch (deleteDoc.target[0]) {
                        case 'm':
                            this.emit('MessageDeleted', event);
                            break;
                        case 'a':
                            this.emit('AssociationDeleted', event);
                            break;
                    }
                    break;
                default:
                    console.info('unknown event', event)
            }
        })
    }
}
