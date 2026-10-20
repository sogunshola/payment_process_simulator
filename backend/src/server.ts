import "reflect-metadata";
import "dotenv/config";
import { loadConfig } from "./config/env";
import { createLogger } from "./common/logger";
import { createDataSource } from "./database/data-source";
import { createGatewayModule } from "./modules/gateway/gateway.module";
import { createHealthModule } from "./modules/health/health.module";
import { createPaymentsModule } from "./modules/payments/payments.module";
import {
  assertRedisReachable,
  closeWorker,
  createProcessingModule,
  reconcileQueue,
} from "./modules/processing/processing.module";
import { createApp } from "./app";

async function main(): Promise<void> {
  let config;
  try {
    // dotenv is loaded by the import above (not inside loadConfig) so tests stay deterministic.
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const logger = createLogger(config);

  const dataSource = createDataSource(config);
  try {
    await dataSource.initialize();
  } catch (err) {
    logger.fatal({ err }, "Database initialization failed");
    process.exit(1);
  }

  // Bounded check (not BullMQ's endless reconnect) so a missing Redis is a clear fatal error.
  try {
    await assertRedisReachable(config.redisUrl);
  } catch (err) {
    logger.fatal({ err }, "Redis is not reachable; start it (docker compose up -d redis) and check REDIS_URL");
    process.exit(1);
  }

  const gatewayModule = createGatewayModule(config.gateway, logger);
  const processing = createProcessingModule(dataSource, gatewayModule.gateway, config, logger);

  // Before listening, so payments whose enqueue failed earlier, or whose job was lost, are queued again.
  try {
    await reconcileQueue(processing.repository, processing.queue, logger);
  } catch (err) {
    logger.fatal({ err }, "Reconciling payments with the queue failed");
    process.exit(1);
  }

  const app = createApp(
    [
      createHealthModule(dataSource, processing.pingRedis),
      createPaymentsModule(dataSource, processing.queue, logger),
      gatewayModule,
    ],
    logger,
    { apiKey: config.apiKey, corsOrigins: config.corsOrigins, rateLimit: config.rateLimit },
  );
  // No listen callback: Express 5 also invokes it with the error on EADDRINUSE,
  // which would log a false "listening" line.
  const server = app.listen(config.port);
  server.on("listening", () => {
    logger.info({ port: config.port }, "Server listening");
    void processing.worker.run().catch((err: unknown) => {
      logger.fatal({ err }, "Payment worker failed to start");
      process.exit(1);
    });
  });

  // e.g. EADDRINUSE: without this the process would crash with a raw stack.
  server.on("error", (err) => {
    logger.fatal({ err }, "Server failed to start");
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return; // a second signal must not re-run teardown
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    // Must exceed the 10s the worker may wait for active jobs below.
    setTimeout(() => {
      logger.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, 20_000).unref();

    // Stop the worker first so no payment is mid-flight while the DB closes, then the
    // queue's Redis connections.
    closeWorker(processing.worker, 10_000, logger)
      .then(() => processing.close())
      .then(() => {
        // Stop accepting connections; callback fires once in-flight requests finish.
        server.close((closeErr) => {
          if (closeErr) logger.error({ err: closeErr }, "Error closing HTTP server");
          dataSource
            .destroy()
            .then(() => {
              logger.info("Shutdown complete");
              process.exit(0);
            })
            .catch((err: unknown) => {
              logger.error({ err }, "Error closing database");
              process.exit(1);
            });
        });
        // Idle keep-alive connections would otherwise block close() until they time out.
        server.closeIdleConnections();
      })
      .catch((err: unknown) => {
        logger.error({ err }, "Error stopping payment worker");
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // State is unknown after these; log and let the supervisor restart us.
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection");
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });
}

void main();
