import { Api } from './api';
import { TimelineItem } from './model';
import { TimelineItemWithUpdate } from './timelineReader';

export interface Query {
    schema?: string,
    owner?: string,
    author?: string,
}

export class QueryTimelineReader {

    body: TimelineItemWithUpdate[] = [];
    onUpdate?: () => void;
    api: Api;
    timeline?: string;
    query: Query = {};
    batch: number = 16;

    constructor(api: Api) {
        this.api = api;
    }

    async init(id: string, query: Query, limit: number): Promise<boolean> {
        this.timeline = id;
        let hasMore = true;
        this.batch = limit;
        this.query = query;

        await this.api.queryTimeline(id, query, undefined, limit).then((items: TimelineItem[]) => {
            const itemsWithUpdate = items.map(item => Object.assign(item, {lastUpdate: new Date()}));
            this.body = itemsWithUpdate;
            if (items.length < limit) {
                hasMore = false;
            }
            this.onUpdate?.();
        })

        return hasMore;
    }

    async readMore(): Promise<boolean> {
        if (!this.timeline) return false;
        if (this.body.length === 0) return false
        const last = this.body[this.body.length - 1];
        const items = await this.api.queryTimeline(this.timeline, this.query, last.created, this.batch);

        const newdata = items.filter(item => !this.body.find(i => i.resourceID === item.resourceID));
        if (newdata.length === 0) return false
        const newdataWithUpdate = newdata.map(item => Object.assign(item, {lastUpdate: new Date()}));
        this.body = this.body.concat(newdataWithUpdate);
        this.onUpdate?.();
        return true
    }

    async reload(): Promise<boolean> {
        if (!this.timeline) return false;
        return this.init(this.timeline, this.query, this.batch);
    }
}

