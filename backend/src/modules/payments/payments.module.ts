import { DataSource } from 'typeorm';
import { Logger } from '../../common/logger';
import { AppModule } from '../../common/types';
import { PaymentQueue } from './payment-queue';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { createPaymentsRouter } from './payments.routes';
import { PaymentsService } from './payments.service';

export function createPaymentsModule(dataSource: DataSource, queue: PaymentQueue, logger: Logger): AppModule {
  const repository = new PaymentsRepository(dataSource);
  const service = new PaymentsService(repository, queue, logger);
  const controller = new PaymentsController(service);
  return { router: createPaymentsRouter(controller) };
}
