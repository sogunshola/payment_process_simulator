import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CURRENCIES, Currency, PaymentStatus } from './payment-status';

export interface PaymentHistoryEntry {
  status: PaymentStatus;
  at: string; // ISO 8601 UTC
  note?: string;
}

// Every column declares an explicit type: tsx/esbuild does not emit decorator
// metadata, so TypeORM cannot infer types from the TS property types in dev.
@Entity('payments')
@Index(['status', 'createdAt'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  reference!: string;

  // Integer minor units (e.g. kobo/cents). Never a float.
  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'simple-enum', enum: CURRENCIES })
  currency!: Currency;

  @Column({ type: 'varchar', length: 256, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 254, nullable: true })
  customerEmail!: string | null;

  @Column({ type: 'simple-enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status!: PaymentStatus;

  @Column({ type: 'varchar', length: 256, nullable: true })
  failureReason!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'datetime', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  idempotencyKey!: string | null;

  // Optimistic concurrency token: bumped on every compare-and-set update.
  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'simple-json' })
  history!: PaymentHistoryEntry[];

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
