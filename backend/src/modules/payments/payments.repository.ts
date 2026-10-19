import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { PaymentStatus } from './payment-status';

/**
 * Thrown when an insert hits the idempotencyKey unique index. Plain Error (not an
 * AppError) so the service can handle the race without knowing about TypeORM.
 */
export class DuplicateIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency key already exists');
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

/** Thrown when an insert hits the reference unique index (generated value collided). */
export class DuplicateReferenceError extends Error {
  constructor() {
    super('Payment reference already exists');
    this.name = 'DuplicateReferenceError';
  }
}

export type NewPayment = Pick<
  Payment,
  'reference' | 'amount' | 'currency' | 'description' | 'customerEmail' | 'status' | 'attempts' | 'history'
> & { idempotencyKey?: string | null };

export type PaymentChanges = Partial<
  Pick<Payment, 'status' | 'history' | 'failureReason' | 'attempts' | 'nextAttemptAt'>
>;

export class PaymentsRepository {
  private readonly repo: Repository<Payment>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(Payment);
  }

  async create(data: NewPayment): Promise<Payment> {
    try {
      return await this.repo.save(this.repo.create(data));
    } catch (err) {
      // Two unique columns exist, so tell them apart by the driver message
      // ("UNIQUE constraint failed: payments.<column>").
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string } | undefined)?.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        const message = String((err.driverError as { message?: string }).message);
        if (message.includes('payments.idempotencyKey')) throw new DuplicateIdempotencyKeyError();
        if (message.includes('payments.reference')) throw new DuplicateReferenceError();
      }
      throw err;
    }
  }

  findById(id: string): Promise<Payment | null> {
    return this.repo.findOneBy({ id });
  }

  findByIdempotencyKey(key: string): Promise<Payment | null> {
    return this.repo.findOneBy({ idempotencyKey: key });
  }

  findByStatus(status: PaymentStatus): Promise<Payment[]> {
    return this.repo.find({ where: { status }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  async list(
    status: PaymentStatus | undefined,
    page: number,
    limit: number,
  ): Promise<{ items: Payment[]; total: number }> {
    const [items, total] = await this.repo.findAndCount({
      where: status ? { status } : {},
      // id is a tiebreak so pages stay stable when createdAt values collide.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async countByStatus(): Promise<Record<PaymentStatus, number>> {
    const rows = await this.repo
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('p.status')
      .getRawMany<{ status: PaymentStatus; count: number | string }>();

    const counts = Object.fromEntries(Object.values(PaymentStatus).map((s) => [s, 0])) as Record<
      PaymentStatus,
      number
    >;
    for (const row of rows) counts[row.status] = Number(row.count);
    return counts;
  }

  /**
   * Compare-and-set: applies `changes` only if the row still has the expected
   * status AND version. Returns false when the row changed underneath the caller.
   *
   * Version is included because status alone has an ABA problem: a reader sees
   * PENDING, the processor moves it PENDING -> PROCESSING -> PENDING (retry), and
   * the stale write would still match "status = PENDING" and clobber the newer
   * history/attempts. Every successful update bumps version, so it never repeats.
   */
  async updateIfStatus(
    id: string,
    expected: { status: PaymentStatus; version: number },
    changes: PaymentChanges,
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(Payment)
      .set({
        ...changes,
        version: () => 'version + 1',
        // Set explicitly so it is a UTC value with millisecond precision, not
        // the driver's second-resolution CURRENT_TIMESTAMP.
        updatedAt: new Date(),
      })
      .where('id = :id AND status = :status AND version = :version', {
        id,
        status: expected.status,
        version: expected.version,
      })
      .execute();
    return result.affected === 1;
  }
}
