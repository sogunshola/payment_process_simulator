import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaymentStatus } from '../payment-status';

export class ListPaymentsQuery {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  // Explicit @Type: implicit conversion relies on decorator metadata, which tsx does not emit.
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
