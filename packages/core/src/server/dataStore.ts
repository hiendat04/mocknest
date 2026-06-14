import * as fs from "fs";
import * as path from "path";

export class DataStore {
  private collections: Map<string, any[]> = new Map();
  private storagePath: string | null = null;

  constructor(storagePath?: string) {
    if (storagePath) {
      this.storagePath = path.resolve(storagePath);
      this.load();
    }
  }

  private load(): void {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.storagePath, "utf-8");
      const data = JSON.parse(content);
      if (typeof data === "object" && data !== null) {
        this.collections = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error(`[MockNest] Failed to load data store from ${this.storagePath}:`, error);
    }
  }

  private save(): void {
    if (!this.storagePath) {
      return;
    }

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.collections);
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      console.error(`[MockNest] Failed to save data store to ${this.storagePath}:`, error);
    }
  }

  getCollection(name: string): any[] {
    if (!this.collections.has(name)) {
      this.collections.set(name, []);
    }
    return this.collections.get(name)!;
  }

  setCollection(name: string, data: any[]): void {
    this.collections.set(name, data);
    this.save();
  }

  addItem(collectionName: string, item: any): void {
    const collection = this.getCollection(collectionName);
    collection.push(item);
    this.save();
  }

  updateItem(
    collectionName: string,
    idField: string,
    idValue: any,
    updates: any,
  ): boolean {
    const collection = this.getCollection(collectionName);
    const index = collection.findIndex((item) => String(item[idField]) === String(idValue));
    if (index !== -1) {
      collection[index] = { ...collection[index], ...updates };
      this.save();
      return true;
    }
    return false;
  }

  deleteItem(collectionName: string, idField: string, idValue: any): boolean {
    const collection = this.getCollection(collectionName);
    const index = collection.findIndex((item) => String(item[idField]) === String(idValue));
    if (index !== -1) {
      collection.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  findItem(collectionName: string, idField: string, idValue: any): any | undefined {
    const collection = this.getCollection(collectionName);
    return collection.find((item) => String(item[idField]) === String(idValue));
  }

  getAll(): Record<string, any[]> {
    return Object.fromEntries(this.collections);
  }

  clearCollection(name: string): void {
    this.collections.set(name, []);
    this.save();
  }

  clear(): void {
    this.collections.clear();
    this.save();
  }
}
