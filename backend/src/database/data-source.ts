import { DataSource } from 'typeorm';
import { AppConfig } from '../config/env';

// Factory rather than a singleton so tests can build an in-memory instance.
export function createDataSource(config: AppConfig): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: config.dbPath,
    // Modules register their entities here.
    entities: [],
    // Auto schema sync is convenient in dev/test only; production would use migrations.
    synchronize: config.nodeEnv !== 'production',
  });
}
