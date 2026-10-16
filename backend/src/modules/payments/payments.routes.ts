import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQuery } from './dto/list-payments.query';
import { PaymentIdParams } from './dto/payment-id.params';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PaymentsController } from './payments.controller';

export function createPaymentsRouter(controller: PaymentsController): Router {
  const router = Router();
  router.post('/payments', validate(CreatePaymentDto, 'body'), controller.create);
  router.get('/payments', validate(ListPaymentsQuery, 'query'), controller.list);
  // Must be registered before /payments/:id, otherwise "stats" is captured as an id.
  router.get('/payments/stats', controller.stats);
  router.get('/payments/:id', validate(PaymentIdParams, 'params'), controller.getById);
  router.patch(
    '/payments/:id/status',
    validate(PaymentIdParams, 'params'),
    validate(UpdateStatusDto, 'body'),
    controller.updateStatus,
  );
  return router;
}
