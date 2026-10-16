import { Request, Response } from 'express';
import { BadRequestError } from '../../common/errors';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQuery } from './dto/list-payments.query';
import { PaymentIdParams } from './dto/payment-id.params';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PaymentsService } from './payments.service';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/;

export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const dto = req.validated?.body as CreatePaymentDto;
    const key = req.header('Idempotency-Key');
    if (key !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestError('Invalid Idempotency-Key header');
    }

    const { payment, replayed } = await this.service.create(dto, key);
    if (replayed) {
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(200).json(payment);
      return;
    }
    // 202: the payment is accepted and will be processed asynchronously.
    res.setHeader('Location', `/payments/${payment.id}`);
    res.status(202).json(payment);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    res.status(200).json(await this.service.list(req.validated?.query as ListPaymentsQuery));
  };

  stats = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(await this.service.stats());
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated?.params as PaymentIdParams;
    res.status(200).json(await this.service.getById(id));
  };

  updateStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated?.params as PaymentIdParams;
    const dto = req.validated?.body as UpdateStatusDto;
    res.status(200).json(await this.service.updateStatus(id, dto));
  };
}
