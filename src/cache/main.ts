
export interface KVS {
    set<T>(key: string, value: T): Promise<void>;
    get<T>(key: string): Promise<T | null>;
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
            const request = store.put(value, key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    }

    async get<T>(key: string): Promise<T | null> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = (event) => resolve((event.target as IDBRequest).result as T | null);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    }
}

export class InMemoryKVS implements KVS {
    private store: Map<string, any> = new Map();

    async set<T>(key: string, value: T): Promise<void> {
        this.store.set(key, value);
    }

    async get<T>(key: string): Promise<T | null> {
        return this.store.has(key) ? (this.store.get(key) as T) : null;
    }
}

