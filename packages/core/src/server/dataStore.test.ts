import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "./dataStore";

describe("DataStore", () => {
  let store: DataStore;

  beforeEach(() => {
    store = new DataStore();
  });

  describe("getCollection", () => {
    it("should create an empty collection if it does not exist", () => {
      const collection = store.getCollection("users");
      expect(collection).toEqual([]);
    });

    it("should return the same collection reference on multiple calls", () => {
      const collection1 = store.getCollection("users");
      const collection2 = store.getCollection("users");
      expect(collection1).toBe(collection2);
    });

    it("should maintain separate collections for different names", () => {
      const users = store.getCollection("users");
      const posts = store.getCollection("posts");
      expect(users).not.toBe(posts);
      expect(users).toEqual([]);
      expect(posts).toEqual([]);
    });
  });

  describe("setCollection", () => {
    it("should replace an entire collection", () => {
      const newData = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
      store.setCollection("users", newData);
      const collection = store.getCollection("users");
      expect(collection).toEqual(newData);
    });

    it("should overwrite existing collection data", () => {
      store.setCollection("users", [{ id: 1, name: "Alice" }]);
      store.setCollection("users", [{ id: 2, name: "Bob" }]);
      const collection = store.getCollection("users");
      expect(collection).toEqual([{ id: 2, name: "Bob" }]);
    });

    it("should allow setting an empty collection", () => {
      store.setCollection("users", []);
      const collection = store.getCollection("users");
      expect(collection).toEqual([]);
    });
  });

  describe("addItem", () => {
    it("should add an item to an existing collection", () => {
      const item = { id: 1, name: "Alice" };
      store.addItem("users", item);
      const collection = store.getCollection("users");
      expect(collection).toContainEqual(item);
      expect(collection).toHaveLength(1);
    });

    it("should add multiple items to a collection", () => {
      store.addItem("users", { id: 1, name: "Alice" });
      store.addItem("users", { id: 2, name: "Bob" });
      const collection = store.getCollection("users");
      expect(collection).toHaveLength(2);
    });

    it("should create a new collection if it does not exist", () => {
      const item = { id: 1, name: "Alice" };
      store.addItem("users", item);
      const collection = store.getCollection("users");
      expect(collection).toContainEqual(item);
    });

    it("should preserve insertion order", () => {
      store.addItem("users", { id: 1 });
      store.addItem("users", { id: 2 });
      store.addItem("users", { id: 3 });
      const collection = store.getCollection("users");
      expect(collection).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it("should allow adding items with various data types", () => {
      store.addItem("mixed", { text: "hello", num: 42, bool: true, nil: null });
      const collection = store.getCollection("mixed");
      expect(collection[0]).toEqual({ text: "hello", num: 42, bool: true, nil: null });
    });
  });

  describe("updateItem", () => {
    beforeEach(() => {
      store.setCollection("users", [
        { id: "1", name: "Alice", age: 30 },
        { id: "2", name: "Bob", age: 25 },
      ]);
    });

    it("should update an existing item by id", () => {
      const success = store.updateItem("users", "id", "1", { age: 31 });
      expect(success).toBe(true);
      const item = store.findItem("users", "id", "1");
      expect(item).toEqual({ id: "1", name: "Alice", age: 31 });
    });

    it("should merge updates with existing item properties", () => {
      store.updateItem("users", "id", "1", { age: 31, role: "admin" });
      const item = store.findItem("users", "id", "1");
      expect(item).toEqual({ id: "1", name: "Alice", age: 31, role: "admin" });
    });

    it("should return false if item not found", () => {
      const success = store.updateItem("users", "id", "999", { age: 99 });
      expect(success).toBe(false);
    });

    it("should handle numeric id fields with string comparison", () => {
      store.setCollection("posts", [{ postId: 1, title: "Hello" }]);
      const success = store.updateItem("posts", "postId", "1", { title: "Updated" });
      expect(success).toBe(true);
      const item = store.findItem("posts", "postId", 1);
      expect(item.title).toBe("Updated");
    });

    it("should not modify other items", () => {
      store.updateItem("users", "id", "1", { name: "Alicia" });
      const bob = store.findItem("users", "id", "2");
      expect(bob.name).toBe("Bob");
    });

    it("should allow updating to empty object (no-op)", () => {
      store.updateItem("users", "id", "1", {});
      const item = store.findItem("users", "id", "1");
      expect(item).toEqual({ id: "1", name: "Alice", age: 30 });
    });
  });

  describe("deleteItem", () => {
    beforeEach(() => {
      store.setCollection("users", [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "3", name: "Charlie" },
      ]);
    });

    it("should delete an existing item by id", () => {
      const success = store.deleteItem("users", "id", "2");
      expect(success).toBe(true);
      const collection = store.getCollection("users");
      expect(collection).toHaveLength(2);
      expect(collection).toEqual([
        { id: "1", name: "Alice" },
        { id: "3", name: "Charlie" },
      ]);
    });

    it("should return false if item not found", () => {
      const success = store.deleteItem("users", "id", "999");
      expect(success).toBe(false);
      const collection = store.getCollection("users");
      expect(collection).toHaveLength(3);
    });

    it("should delete multiple items in sequence", () => {
      store.deleteItem("users", "id", "1");
      store.deleteItem("users", "id", "3");
      const collection = store.getCollection("users");
      expect(collection).toHaveLength(1);
      expect(collection[0]).toEqual({ id: "2", name: "Bob" });
    });

    it("should handle numeric id fields with string comparison", () => {
      store.setCollection("posts", [
        { postId: 1, title: "First" },
        { postId: 2, title: "Second" },
      ]);
      const success = store.deleteItem("posts", "postId", "1");
      expect(success).toBe(true);
      const collection = store.getCollection("posts");
      expect(collection).toEqual([{ postId: 2, title: "Second" }]);
    });
  });

  describe("findItem", () => {
    beforeEach(() => {
      store.setCollection("users", [
        { id: "1", name: "Alice", role: "admin" },
        { id: "2", name: "Bob", role: "user" },
      ]);
    });

    it("should find an existing item by id", () => {
      const item = store.findItem("users", "id", "1");
      expect(item).toEqual({ id: "1", name: "Alice", role: "admin" });
    });

    it("should return undefined if item not found", () => {
      const item = store.findItem("users", "id", "999");
      expect(item).toBeUndefined();
    });

    it("should handle numeric ids with string comparison", () => {
      store.setCollection("posts", [{ postId: 42, title: "Hello" }]);
      const item = store.findItem("posts", "postId", "42");
      expect(item).toEqual({ postId: 42, title: "Hello" });
    });

    it("should find on the first match", () => {
      store.setCollection("items", [
        { id: "1", value: "a" },
        { id: "1", value: "b" }, // Duplicate id (edge case)
      ]);
      const item = store.findItem("items", "id", "1");
      expect(item).toEqual({ id: "1", value: "a" });
    });
  });

  describe("clear", () => {
    it("should clear all collections", () => {
      store.setCollection("users", [{ id: "1", name: "Alice" }]);
      store.setCollection("posts", [{ id: "1", title: "Hello" }]);
      store.clear();
      expect(store.getCollection("users")).toEqual([]);
      expect(store.getCollection("posts")).toEqual([]);
    });

    it("should allow adding items after clear", () => {
      store.setCollection("users", [{ id: "1" }]);
      store.clear();
      store.addItem("users", { id: "2" });
      expect(store.getCollection("users")).toEqual([{ id: "2" }]);
    });
  });

  describe("complex scenarios", () => {
    it("should handle CRUD operations in sequence", () => {
      // Create
      store.addItem("users", { id: "1", name: "Alice", age: 30 });
      store.addItem("users", { id: "2", name: "Bob", age: 25 });

      // Read
      expect(store.getCollection("users")).toHaveLength(2);
      expect(store.findItem("users", "id", "1")).toEqual({ id: "1", name: "Alice", age: 30 });

      // Update
      store.updateItem("users", "id", "1", { age: 31 });
      expect(store.findItem("users", "id", "1").age).toBe(31);

      // Delete
      store.deleteItem("users", "id", "2");
      expect(store.getCollection("users")).toHaveLength(1);
    });

    it("should maintain multiple independent collections", () => {
      store.addItem("users", { id: "1", name: "Alice" });
      store.addItem("posts", { id: "1", title: "Hello" });
      store.addItem("comments", { id: "1", text: "Nice!" });

      expect(store.getCollection("users")).toHaveLength(1);
      expect(store.getCollection("posts")).toHaveLength(1);
      expect(store.getCollection("comments")).toHaveLength(1);

      store.deleteItem("posts", "id", "1");
      expect(store.getCollection("users")).toHaveLength(1);
      expect(store.getCollection("posts")).toHaveLength(0);
    });

    it("should handle deeply nested object updates", () => {
      store.addItem("users", { id: "1", profile: { name: "Alice", settings: { theme: "dark" } } });
      store.updateItem("users", "id", "1", { profile: { name: "Alicia", settings: { theme: "light" } } });
      const item = store.findItem("users", "id", "1");
      expect(item.profile).toEqual({ name: "Alicia", settings: { theme: "light" } });
    });
  });
});
