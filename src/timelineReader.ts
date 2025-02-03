import { Socket } from './socket';
import { Api } from './api';
import { Association, CCDocument, TimelineEvent, TimelineItem } from './model';

export class TimelineItemWithUpdate extends TimelineItem {
    lastUpdate: Date = new Date();
}

export class TimelineReader {

    body: TimelineItemWithUpdate[] = [];
    onUpdate?: () => void;
    onRealtimeEvent?: (event: TimelineEvent) => void;
    socket?: Socket;
    api: Api;
    streams: string[] = [];

    constructor(api: Api, socket?: Socket) {
        this.api = api;
        this.socket = socket;
    }

    processEvent(event: TimelineEvent) {
        switch (event.parsedDoc.type) {
            case 'message': {
                if (this.body.find(m => m.resourceID === event.item.resourceID)) return;
                const item = Object.assign(event.item, {lastUpdate: new Date()});
                this.body.unshift(item);
                this.onUpdate?.();
                break;
            }
            case 'association': {
                const document = event.parsedDoc as CCDocument.Association<any>
                const target = this.body.find(m => m.resourceID === document.target);
                if (!target) return;
                target.lastUpdate = new Date();
                this.onUpdate?.();
                break;
            }
            case 'delete': {
                if (!event.document) return;
                const document = event.parsedDoc as CCDocument.Delete
                switch (document.target[0]) {
                    case 'm':
                        this.body = this.body.filter(m => m.resourceID !== document.target);
                        this.onUpdate?.();
                        break;
                    case 'a':
                        if (!event.resource) return;
                        const resource = event.resource as Association<any>
                        const target = this.body.find(m => m.resourceID === resource.target);
                        if (!target) return;
                        target.lastUpdate = new Date();
                        this.onUpdate?.();
                        break;
                }
                break;
            }
            default:
                if (event.item.resourceID) {
                    switch (event.item.resourceID[0]) {
                        case 'm': {
                            if (this.body.find(m => m.resourceID === event.item.resourceID)) return;
                            const item = Object.assign(event.item, {lastUpdate: new Date()});
                            this.body.unshift(item);
                            this.onUpdate?.();
                            break;
                        }
                    }
                }
        }

        this.onRealtimeEvent?.(event);
    }

    async listen(streams: string[]): Promise<boolean> {

        this.streams = streams;

        let hasMore = true;

        await this.api.getTimelineRecent(streams).then((items: TimelineItem[]) => {
            const itemsWithUpdate = items.map(item => Object.assign(item, {lastUpdate: new Date()}));
            this.body = itemsWithUpdate;
            if (items.length < 16) {
                hasMore = false;
            }
            this.onUpdate?.();
        })

        this.socket?.listen(streams, this.processEvent.bind(this));
    
        return hasMore
    }

    async readMore(): Promise<boolean> {
        if (this.body.length === 0) return false
        const last = this.body[this.body.length - 1];
        const items = await this.api.getTimelineRanged(this.streams, {until: last.created});
        const newdata = items.filter(item => !this.body.find(i => i.resourceID === item.resourceID));
        const newdataWithUpdate = newdata.map(item => Object.assign(item, {lastUpdate: new Date()}));
        if (newdata.length === 0) return false
        this.body = this.body.concat(newdataWithUpdate);
        this.onUpdate?.();
        return true
    }

    async reload(): Promise<boolean> {
        let hasMore = true;
        const items = await this.api.getTimelineRecent(this.streams);
        const itemsWithUpdate = items.map(item => Object.assign(item, {lastUpdate: new Date()}));
        this.body = itemsWithUpdate;
        if (items.length < 16) {
            hasMore = false;
        }
        this.onUpdate?.();
        return hasMore
    }

    dispose() {
        this.socket?.unlisten(this.streams, this.processEvent);
        this.onUpdate = undefined;
        this.onRealtimeEvent = undefined;
    }
}
