import { DataSource } from 'typeorm';
import { AppModule } from '../../common/types';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { createPaymentsRouter } from './payments.routes';
import { PaymentsService } from './payments.service';

export function createPaymentsModule(dataSource: DataSource): AppModule {
  const repository = new PaymentsRepository(dataSource);
  const service = new PaymentsService(repository);
  const controller = new PaymentsController(service);
  return { router: createPaymentsRouter(controller) };
}
