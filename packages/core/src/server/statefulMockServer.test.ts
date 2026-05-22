import { describe, it, expect, afterEach } from "vitest";
import { MockServer } from "./mockServer";

describe("MockServer Stateful Mocks", () => {
  let server: MockServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("should persist items created via POST", async () => {
    server = new MockServer({
      port: 3010,
      stateful: true,
      routes: [
        {
          method: "GET",
          path: "/users",
          statusCode: 200,
          responseSchema: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } },
          responses: []
        },
        {
          method: "POST",
          path: "/users",
          statusCode: 201,
          responseSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
          responses: []
        }
      ],
    });

    await server.start();

    // 1. Initial GET should be empty (or seeded, but here we expect empty as we'll check POST next)
    const res1 = await fetch("http://localhost:3010/users");
    const initialData: any = await res1.json();
    const initialCount = initialData.length;

    // 2. POST a new user
    const res2 = await fetch("http://localhost:3010/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    const newUser: any = await res2.json();
    expect(newUser.name).toBe("Alice");
    expect(newUser.id).toBeDefined();

    // 3. GET users should now contain Alice
    const res3 = await fetch("http://localhost:3010/users");
    const updatedData: any = await res3.json();
    expect(updatedData).toHaveLength(initialCount + 1);
    expect(updatedData.some((u: any) => u.name === "Alice")).toBe(true);
  });

  it("should support GET, PUT, and DELETE on items", async () => {
    server = new MockServer({
      port: 3011,
      stateful: true,
      routes: [
        {
          method: "GET",
          path: "/tasks/:taskId",
          statusCode: 200,
          responseSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, done: { type: "boolean" } } },
          responses: []
        },
        {
          method: "PUT",
          path: "/tasks/:taskId",
          statusCode: 200,
          responseSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, done: { type: "boolean" } } },
          responses: []
        },
        {
          method: "DELETE",
          path: "/tasks/:taskId",
          statusCode: 200,
          responses: []
        }
      ],
    });

    await server.start();

    // 1. GET non-existent item should create it (discovery)
    const res1 = await fetch("http://localhost:3011/tasks/task-1");
    const task1: any = await res1.json();
    expect(task1.id).toBe("task-1");
    const initialTitle = task1.title;

    // 2. PUT updates the item
    const res2 = await fetch("http://localhost:3011/tasks/task-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated Title", done: true }),
    });
    const updatedTask: any = await res2.json();
    expect(updatedTask.title).toBe("Updated Title");
    expect(updatedTask.done).toBe(true);

    // 3. GET should return updated version
    const res3 = await fetch("http://localhost:3011/tasks/task-1");
    const task1Again: any = await res3.json();
    expect(task1Again.title).toBe("Updated Title");

    // 4. DELETE removes the item
    await fetch("http://localhost:3011/tasks/task-1", { method: "DELETE" });
    
    // 5. GET again should recreate it (with random data)
    const res4 = await fetch("http://localhost:3011/tasks/task-1");
    const task1New: any = await res4.json();
    expect(task1New.title).not.toBe("Updated Title");
  });
});
