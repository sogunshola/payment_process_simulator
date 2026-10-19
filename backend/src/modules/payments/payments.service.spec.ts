import pino from 'pino';
import { ConflictError, NotFoundError } from '../../common/errors';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Payment } from './payment.entity';
import { PaymentQueue } from './payment-queue';
import { PaymentStatus } from './payment-status';
import { DuplicateIdempotencyKeyError, DuplicateReferenceError, PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

type Repo = jest.Mocked<
  Pick<
    PaymentsRepository,
    'create' | 'findById' | 'findByIdempotencyKey' | 'list' | 'countByStatus' | 'updateIfStatus'
  >
>;

const dto: CreatePaymentDto = { amount: 5000, currency: 'NGN' };

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'ref-1',
    amount: 5000,
    currency: 'NGN',
    description: null,
    customerEmail: null,
    status: PaymentStatus.PENDING,
    failureReason: null,
    attempts: 0,
    nextAttemptAt: null,
    idempotencyKey: null,
    version: 1,
    history: [{ status: PaymentStatus.PENDING, at: '2026-01-01T00:00:00.000Z', note: 'Payment created' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PaymentsService', () => {
  let repo: Repo;
  let queue: jest.Mocked<PaymentQueue>;
  let logger: { error: jest.Mock };
  let service: PaymentsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      list: jest.fn(),
      countByStatus: jest.fn(),
      updateIfStatus: jest.fn(),
    };
    queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    logger = { error: jest.fn() };
    service = new PaymentsService(repo as unknown as PaymentsRepository, queue, logger as unknown as pino.Logger);
  });

  describe('create', () => {
    it('creates a PENDING payment with one history entry', async () => {
      repo.create.mockImplementation((data) => Promise.resolve(makePayment(data as Partial<Payment>)));
      const { payment, replayed } = await service.create(dto);
      expect(replayed).toBe(false);
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
      const arg = repo.create.mock.calls[0][0];
      expect(arg).toMatchObject({ status: PaymentStatus.PENDING, attempts: 0, description: null, customerEmail: null });
      expect(arg.history).toHaveLength(1);
      expect(payment.status).toBe(PaymentStatus.PENDING);
    });

    it('replays when the key exists with a matching request', async () => {
      const existing = makePayment({ idempotencyKey: 'k1' });
      repo.findByIdempotencyKey.mockResolvedValue(existing);
      await expect(service.create(dto, 'k1')).resolves.toEqual({ payment: existing, replayed: true });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects when the key exists with a different request', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(makePayment({ idempotencyKey: 'k1', amount: 1 }));
      await expect(service.create(dto, 'k1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('returns the winner when a concurrent insert wins the race', async () => {
      const winner = makePayment({ idempotencyKey: 'k1' });
      repo.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      repo.create.mockRejectedValue(new DuplicateIdempotencyKeyError());
      await expect(service.create(dto, 'k1')).resolves.toEqual({ payment: winner, replayed: true });
    });

    it('rejects when the race winner had a different request', async () => {
      repo.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makePayment({ idempotencyKey: 'k1', currency: 'USD' }));
      repo.create.mockRejectedValue(new DuplicateIdempotencyKeyError());
      await expect(service.create(dto, 'k1')).rejects.toBeInstanceOf(ConflictError);
    });

    it('replays with the original reference', async () => {
      const existing = makePayment({ idempotencyKey: 'k1', reference: 'PAY-ORIGINAL00000' });
      repo.findByIdempotencyKey.mockResolvedValue(existing);
      const { payment } = await service.create(dto, 'k1');
      expect(payment.reference).toBe('PAY-ORIGINAL00000');
    });

    it('regenerates the reference and retries on a reference collision', async () => {
      const refs = ['PAY-AAA', 'PAY-BBB'];
      const svc = new PaymentsService(
        repo as unknown as PaymentsRepository,
        queue,
        logger as unknown as pino.Logger,
        () => refs.shift() as string,
      );
      repo.create
        .mockRejectedValueOnce(new DuplicateReferenceError())
        .mockImplementationOnce((data) => Promise.resolve(makePayment(data as Partial<Payment>)));
      const { payment } = await svc.create(dto);
      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.create.mock.calls.map((c) => c[0].reference)).toEqual(['PAY-AAA', 'PAY-BBB']);
      expect(payment.reference).toBe('PAY-BBB');
    });

    it('gives up with a generic error after 3 reference collisions', async () => {
      repo.create.mockRejectedValue(new DuplicateReferenceError());
      const err = await service.create(dto).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(DuplicateReferenceError);
      expect(repo.create).toHaveBeenCalledTimes(3);
    });

    it('rethrows other create errors unchanged', async () => {
      const boom = new Error('disk full');
      repo.create.mockRejectedValue(boom);
      await expect(service.create(dto, 'k1')).rejects.toBe(boom);
    });
  });

  describe('getById', () => {
    it('throws NotFoundError when missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getById('x')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('stats includes a total', async () => {
    repo.countByStatus.mockResolvedValue({
      PENDING: 2,
      PROCESSING: 1,
      SUCCEEDED: 0,
      FAILED: 3,
      CANCELLED: 0,
    });
    await expect(service.stats()).resolves.toEqual({
      PENDING: 2,
      PROCESSING: 1,
      SUCCEEDED: 0,
      FAILED: 3,
      CANCELLED: 0,
      total: 6,
    });
  });

  it('list returns paging metadata', async () => {
    repo.list.mockResolvedValue({ items: [makePayment()], total: 7 });
    const res = await service.list({ page: 2, limit: 1 });
    expect(repo.list).toHaveBeenCalledWith(undefined, 2, 1);
    expect(res).toMatchObject({ page: 2, limit: 1, total: 7 });
    expect(res.data).toHaveLength(1);
  });

  describe('queueing', () => {
    beforeEach(() => {
      repo.create.mockImplementation((data) => Promise.resolve(makePayment(data as Partial<Payment>)));
    });

    it('enqueues a newly created payment', async () => {
      const { payment } = await service.create(dto);
      expect(queue.enqueue).toHaveBeenCalledTimes(1);
      expect(queue.enqueue).toHaveBeenCalledWith(payment.id);
    });

    it('does not enqueue on an idempotent replay', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(makePayment());
      const { replayed } = await service.create(dto, 'k1');
      expect(replayed).toBe(true);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('does not enqueue when it loses the idempotency race', async () => {
      repo.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(makePayment());
      repo.create.mockRejectedValue(new DuplicateIdempotencyKeyError());
      await service.create(dto, 'k1');
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('still returns the payment, and logs, when the queue is down', async () => {
      queue.enqueue.mockRejectedValue(new Error('redis down'));
      const { payment, replayed } = await service.create(dto);
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(replayed).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: payment.id }),
        expect.stringContaining('Failed to enqueue'),
      );
    });

    it('enqueues after a PATCH to PENDING, but not after other transitions', async () => {
      repo.findById.mockResolvedValue(makePayment({ status: PaymentStatus.PROCESSING }));
      repo.updateIfStatus.mockResolvedValue(true);
      await service.updateStatus('id', { status: PaymentStatus.PENDING });
      expect(queue.enqueue).toHaveBeenCalledWith('id');

      queue.enqueue.mockClear();
      repo.findById.mockResolvedValue(makePayment({ status: PaymentStatus.PENDING }));
      await service.updateStatus('id', { status: PaymentStatus.CANCELLED });
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('does not enqueue when the PATCH to PENDING loses the compare-and-set', async () => {
      repo.findById
        .mockResolvedValueOnce(makePayment({ status: PaymentStatus.PROCESSING }))
        .mockResolvedValueOnce(makePayment({ status: PaymentStatus.SUCCEEDED, version: 2 }));
      repo.updateIfStatus.mockResolvedValue(false);
      await expect(service.updateStatus('id', { status: PaymentStatus.PENDING })).rejects.toBeInstanceOf(ConflictError);
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('still succeeds a PATCH to PENDING when the queue is down', async () => {
      repo.findById.mockResolvedValue(makePayment({ status: PaymentStatus.PROCESSING }));
      repo.updateIfStatus.mockResolvedValue(true);
      queue.enqueue.mockRejectedValue(new Error('redis down'));
      await expect(service.updateStatus('id', { status: PaymentStatus.PENDING })).resolves.toBeDefined();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateStatus', () => {
    it('rejects an illegal transition with 409 and details', async () => {
      repo.findById.mockResolvedValue(makePayment({ status: PaymentStatus.CANCELLED }));
      const err: ConflictError = await service
        .updateStatus('id', { status: PaymentStatus.PENDING })
        .then(() => {
          throw new Error('expected rejection');
        }, (e: ConflictError) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.message).toBe('Cannot transition payment from CANCELLED to PENDING');
      expect(err.details).toEqual({ currentStatus: 'CANCELLED', requestedStatus: 'PENDING' });
      expect(repo.updateIfStatus).not.toHaveBeenCalled();
    });

    it('reports the fresh status when the compare-and-set is lost', async () => {
      repo.findById
        .mockResolvedValueOnce(makePayment({ status: PaymentStatus.PENDING }))
        .mockResolvedValueOnce(makePayment({ status: PaymentStatus.PROCESSING, version: 2 }));
      repo.updateIfStatus.mockResolvedValue(false);
      await expect(service.updateStatus('id', { status: PaymentStatus.CANCELLED })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Cannot transition payment from PROCESSING to CANCELLED',
        details: { currentStatus: 'PROCESSING', requestedStatus: 'CANCELLED' },
      });
    });

    it('passes the read status and version to the compare-and-set and appends history', async () => {
      const current = makePayment({ version: 4 });
      repo.findById.mockResolvedValue(current);
      repo.updateIfStatus.mockResolvedValue(true);
      await service.updateStatus('id', { status: PaymentStatus.CANCELLED, reason: 'customer asked' });
      const [, expected, changes] = repo.updateIfStatus.mock.calls[0];
      expect(expected).toEqual({ status: PaymentStatus.PENDING, version: 4 });
      expect(changes.status).toBe(PaymentStatus.CANCELLED);
      expect(changes.history).toHaveLength(2);
      expect(changes.history?.[1]).toMatchObject({ status: 'CANCELLED', note: 'customer asked' });
      expect(changes.failureReason).toBeUndefined();
    });

    it('sets failureReason when moving to FAILED', async () => {
      repo.findById.mockResolvedValue(makePayment({ status: PaymentStatus.PROCESSING }));
      repo.updateIfStatus.mockResolvedValue(true);
      await service.updateStatus('id', { status: PaymentStatus.FAILED, reason: 'card declined' });
      expect(repo.updateIfStatus.mock.calls[0][2].failureReason).toBe('card declined');

      await service.updateStatus('id', { status: PaymentStatus.FAILED });
      expect(repo.updateIfStatus.mock.calls[1][2].failureReason).toBe('Marked as failed');
    });

    it('sets nextAttemptAt on a retry back to PENDING', async () => {
      repo.findById.mockResolvedValue(makePayment({ status: PaymentStatus.PROCESSING }));
      repo.updateIfStatus.mockResolvedValue(true);
      await service.updateStatus('id', { status: PaymentStatus.PENDING });
      expect(repo.updateIfStatus.mock.calls[0][2].nextAttemptAt).toBeInstanceOf(Date);
    });
  });
});
