import { DataSource } from 'typeorm';
import { Logger } from '../../common/logger';
import { PaymentGateway } from '../gateway/gateway.types';
import { PaymentsRepository } from '../payments/payments.repository';
import { PaymentProcessor, ProcessorOptions } from './payment-processor';

// No router: the processor is a background worker with no HTTP surface.
export function createProcessingModule(
  dataSource: DataSource,
  gateway: PaymentGateway,
  options: ProcessorOptions,
  logger: Logger,
): { processor: PaymentProcessor } {
  const processor = new PaymentProcessor(new PaymentsRepository(dataSource), gateway, options, logger);
  return { processor };
}
