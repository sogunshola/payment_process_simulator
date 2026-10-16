import { IsUUID } from 'class-validator';

export class PaymentIdParams {
  @IsUUID()
  id!: string;
}
