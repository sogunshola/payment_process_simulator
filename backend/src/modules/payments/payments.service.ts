import { ConflictError, NotFoundError } from '../../common/errors';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ListPaymentsQuery } from './dto/list-payments.query';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Payment } from './payment.entity';
import { PaymentStatus, canTransition } from './payment-status';
import { DuplicateIdempotencyKeyError, PaymentsRepository } from './payments.repository';

const KEY_REUSED_MESSAGE = 'Idempotency-Key has already been used with a different request';

export class PaymentsService {
  constructor(private readonly repository: PaymentsRepository) {}

  async create(dto: CreatePaymentDto, idempotencyKey?: string): Promise<{ payment: Payment; replayed: boolean }> {
    if (idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
      if (existing) return { payment: this.replay(existing, dto), replayed: true };
    }

    try {
      const payment = await this.repository.create({
        reference: dto.reference,
        amount: dto.amount,
        currency: dto.currency,
        description: dto.description ?? null,
        customerEmail: dto.customerEmail ?? null,
        status: PaymentStatus.PENDING,
        attempts: 0,
        history: [{ status: PaymentStatus.PENDING, at: new Date().toISOString(), note: 'Payment created' }],
        idempotencyKey: idempotencyKey ?? null,
      });
      return { payment, replayed: false };
    } catch (err) {
      if (!idempotencyKey || !(err instanceof DuplicateIdempotencyKeyError)) throw err;
      // Two requests with the same key both passed the lookup above; the unique
      // index let only one insert through. Treat the loser as a replay of the winner.
      const winner = await this.repository.findByIdempotencyKey(idempotencyKey);
      if (!winner) throw err; // row vanished between insert and read; should not happen
      return { payment: this.replay(winner, dto), replayed: true };
    }
  }

  async getById(id: string): Promise<Payment> {
    const payment = await this.repository.findById(id);
    if (!payment) throw new NotFoundError(`Payment ${id} not found`);
    return payment;
  }

  async list(query: ListPaymentsQuery): Promise<{ data: Payment[]; page: number; limit: number; total: number }> {
    const { items, total } = await this.repository.list(query.status, query.page, query.limit);
    return { data: items, page: query.page, limit: query.limit, total };
  }

  async stats(): Promise<Record<PaymentStatus, number> & { total: number }> {
    const counts = await this.repository.countByStatus();
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { ...counts, total };
  }

  async updateStatus(id: string, dto: UpdateStatusDto): Promise<Payment> {
    const current = await this.getById(id);
    if (!canTransition(current.status, dto.status)) {
      throw this.illegalTransition(current.status, dto.status);
    }

    const now = new Date();
    const changes: Parameters<PaymentsRepository['updateIfStatus']>[2] = {
      status: dto.status,
      history: [
        ...current.history,
        { status: dto.status, at: now.toISOString(), note: dto.reason ?? `Status changed to ${dto.status}` },
      ],
    };
    if (dto.status === PaymentStatus.FAILED) changes.failureReason = dto.reason ?? 'Marked as failed';
    // Back to PENDING is a retry: make it immediately eligible for pickup.
    if (dto.status === PaymentStatus.PENDING) changes.nextAttemptAt = now;

    const updated = await this.repository.updateIfStatus(
      id,
      { status: current.status, version: current.version },
      changes,
    );
    if (!updated) {
      // Lost the race with the processor or another request: the row changed
      // after we read it. Report against the fresh state rather than overwrite it.
      const fresh = await this.getById(id);
      throw this.illegalTransition(fresh.status, dto.status);
    }
    return this.getById(id);
  }

  private replay(existing: Payment, dto: CreatePaymentDto): Payment {
    const same =
      existing.amount === dto.amount &&
      existing.currency === dto.currency &&
      existing.reference === dto.reference &&
      existing.description === (dto.description ?? null) &&
      existing.customerEmail === (dto.customerEmail ?? null);
    if (!same) throw new ConflictError(KEY_REUSED_MESSAGE);
    return existing;
  }

  private illegalTransition(current: PaymentStatus, requested: PaymentStatus): ConflictError {
    return new ConflictError(`Cannot transition payment from ${current} to ${requested}`, {
      currentStatus: current,
      requestedStatus: requested,
    });
  }
}
