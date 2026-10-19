import { DataSource } from 'typeorm';
import { AppModule } from '../../common/types';
import { HealthController } from './health.controller';
import { HealthRepository } from './health.repository';
import { createHealthRouter } from './health.routes';
import { HealthService } from './health.service';

export function createHealthModule(dataSource: DataSource, pingRedis?: () => Promise<void>): AppModule {
  const repository = new HealthRepository(dataSource);
  const service = new HealthService(repository, pingRedis);
  const controller = new HealthController(service);
  return { router: createHealthRouter(controller), public: true };
}
