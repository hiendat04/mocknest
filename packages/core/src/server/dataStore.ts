export class DataStore {
  private collections: Map<string, any[]> = new Map();

  getCollection(name: string): any[] {
    if (!this.collections.has(name)) {
      this.collections.set(name, []);
    }
    return this.collections.get(name)!;
  }

  setCollection(name: string, data: any[]): void {
    this.collections.set(name, data);
  }

  addItem(collectionName: string, item: any): void {
    const collection = this.getCollection(collectionName);
    collection.push(item);
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
      return true;
    }
    return false;
  }

  deleteItem(collectionName: string, idField: string, idValue: any): boolean {
    const collection = this.getCollection(collectionName);
    const index = collection.findIndex((item) => String(item[idField]) === String(idValue));
    if (index !== -1) {
      collection.splice(index, 1);
      return true;
    }
    return false;
  }

  findItem(collectionName: string, idField: string, idValue: any): any | undefined {
    const collection = this.getCollection(collectionName);
    return collection.find((item) => String(item[idField]) === String(idValue));
  }

  clear(): void {
    this.collections.clear();
  }
}
