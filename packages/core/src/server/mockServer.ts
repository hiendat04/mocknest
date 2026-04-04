import express, { Express, Request, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { ParsedRoute } from "../parser/openApiParser";
import { generateFakeData } from "../generator/fakeDataGenerator";

export interface MockServerOptions {
  port: number;
  routes: ParsedRoute[];
  onRequest?: (method: string, path: string, statusCode: number) => void;
  delay?: number;
  errorRate?: number;
}

export class MockServer {
  private app: Express;
  private server: Server | null = null;

  constructor(private options: MockServerOptions) {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.registerRoutes();
  }

  private registerRoutes() {
    for (const route of this.options.routes) {
      const method = route.method.toLowerCase() as keyof Express;

      // Dispatch handlers from the HTTP verb string in the parsed route.
      (this.app as any)[method](route.path, (req: Request, res: Response) => {
        const fakeBody = route.responseSchema
          ? generateFakeData(route.responseSchema)
          : {};

        // Chaos mode (Error Rate)
        if (this.options.errorRate && this.options.errorRate > 0) {
          const random = Math.random();
          if (random < this.options.errorRate) {
            this.options.onRequest?.(route.method, req.path, 500);
            setTimeout(() => {
              res.setHeader("Content-Type", "application/json");
              res.status(500).send(JSON.stringify({ error: "Internal Server Error (Simulated)" }, null, 2));
            }, this.options.delay ?? 20);
            return;
          }
        }

        this.options.onRequest?.(route.method, req.path, route.statusCode);

        // Artificial delay to simulate real network
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          res.status(route.statusCode).send(JSON.stringify(fakeBody, null, 2));
        }, this.options.delay ?? 20);
      });
    }

    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: "Route not mocked", path: req.path });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.options.port, () => {
        console.log(
          `MockNest running on http://localhost:${this.options.port}`,
        );
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}

function faker_delay(): number {
  return Math.floor(Math.random() * 100) + 20;
}
