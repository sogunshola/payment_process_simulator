import { DataSource } from 'typeorm';
import { AppConfig } from '../config/env';
import { Payment } from '../modules/payments/payment.entity';

// Factory rather than a singleton so tests can build an in-memory instance.
export function createDataSource(config: AppConfig): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: config.dbPath,
    // Modules register their entities here.
    entities: [Payment],
    // Auto schema sync is convenient in dev/test only; production would use migrations.
    synchronize: config.nodeEnv !== 'production',
  });
}
