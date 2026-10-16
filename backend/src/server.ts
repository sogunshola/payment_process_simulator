import 'reflect-metadata';
import 'dotenv/config';
import { loadConfig } from './config/env';
import { createLogger } from './common/logger';
import { createDataSource } from './database/data-source';
import { createGatewayModule } from './modules/gateway/gateway.module';
import { createHealthModule } from './modules/health/health.module';
import { createPaymentsModule } from './modules/payments/payments.module';
import { createProcessingModule } from './modules/processing/processing.module';
import { createApp } from './app';

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
    logger.fatal({ err }, 'Database initialization failed');
    process.exit(1);
  }

  const gatewayModule = createGatewayModule(config.gateway, logger);
  const { processor } = createProcessingModule(dataSource, gatewayModule.gateway, config.processor, logger);

  // Before listening, so the processor never races requests against rows from a crashed run.
  try {
    await processor.recoverStuck();
  } catch (err) {
    logger.fatal({ err }, 'Recovering stuck payments failed');
    process.exit(1);
  }

  const app = createApp(
    [createHealthModule(dataSource), createPaymentsModule(dataSource), gatewayModule],
    logger,
  );
  // No listen callback: Express 5 also invokes it with the error on EADDRINUSE,
  // which would log a false "listening" line.
  const server = app.listen(config.port);
  server.on('listening', () => {
    logger.info({ port: config.port }, 'Server listening');
    processor.start();
  });

  // e.g. EADDRINUSE: without this the process would crash with a raw stack.
  server.on('error', (err) => {
    logger.fatal({ err }, 'Server failed to start');
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return; // a second signal must not re-run teardown
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    // Must exceed processor.stop(), which may legitimately wait up to 10s for in-flight
    // payments; with the old 10s timer the force-exit would fire before it finished.
    setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 20_000).unref();

    // Stop the processor first so no payment is mid-flight while the DB closes.
    // stop() never rejects; it gives up waiting after its own timeout.
    processor
      .stop()
      .then(() => {
        // Stop accepting connections; callback fires once in-flight requests finish.
        server.close((closeErr) => {
          if (closeErr) logger.error({ err: closeErr }, 'Error closing HTTP server');
          dataSource
            .destroy()
            .then(() => {
              logger.info('Shutdown complete');
              process.exit(0);
            })
            .catch((err: unknown) => {
              logger.error({ err }, 'Error closing database');
              process.exit(1);
            });
        });
        // Idle keep-alive connections would otherwise block close() until they time out.
        server.closeIdleConnections();
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'Error stopping payment processor');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // State is unknown after these; log and let the supervisor restart us.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

void main();
