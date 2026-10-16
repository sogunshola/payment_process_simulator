import { ConflictError, NotFoundError } from '../../common/errors';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Payment } from './payment.entity';
import { PaymentStatus } from './payment-status';
import { DuplicateIdempotencyKeyError, PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

type Repo = jest.Mocked<
  Pick<
    PaymentsRepository,
    'create' | 'findById' | 'findByIdempotencyKey' | 'list' | 'countByStatus' | 'updateIfStatus'
  >
>;

const dto: CreatePaymentDto = { reference: 'ref-1', amount: 5000, currency: 'NGN' };

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
    service = new PaymentsService(repo as unknown as PaymentsRepository);
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
