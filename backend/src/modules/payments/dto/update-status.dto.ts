import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentStatus } from '../payment-status';

const CLIENT_SETTABLE = Object.values(PaymentStatus).filter((s) => s !== PaymentStatus.PROCESSING);

export class UpdateStatusDto {
  @IsEnum(PaymentStatus)
  @IsIn(CLIENT_SETTABLE, { message: 'status PROCESSING is reserved for the payment processor' })
  status!: PaymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}
