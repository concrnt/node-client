
export interface KVS {
    set<T>(key: string, value: T): Promise<void>;
    get<T>(key: string): Promise<KVSEntry<T> | null>;
    invalidate(key: string): Promise<void>;
}

export interface KVSEntry<T> {
    data: T;
    timestamp: number;
}


export class IndexedDBKVS implements KVS {
    private dbName: string;
    private storeName: string;

    constructor(dbName: string, storeName: string) {
        this.dbName = dbName;
        this.storeName = storeName;
    }

    private async initDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };

            request.onsuccess = (event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onerror = (event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    async set<T>(key: string, value: T): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.put({ data: value, timestamp: Date.now() }, key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    }

    async get<T>(key: string): Promise<KVSEntry<T> | null> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = (event) => resolve((event.target as IDBRequest).result as KVSEntry<T> | null);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    }

    async invalidate(key: string): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    }
}

export class InMemoryKVS implements KVS {
    private store: Map<string, any> = new Map();

    async set<T>(key: string, value: T): Promise<void> {
        this.store.set(key, { data: value, timestamp: Date.now() });
    }

    async get<T>(key: string): Promise<KVSEntry<T> | null> {
        return this.store.has(key) ? (this.store.get(key) as KVSEntry<T>) : null;
    }

    async invalidate(key: string): Promise<void> {
        this.store.delete(key);
    }
}

