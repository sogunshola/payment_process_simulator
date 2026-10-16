import { IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { CURRENCIES, Currency } from '../payment-status';

export class CreatePaymentDto {
  @IsString()
  @Length(1, 64)
  @Matches(/\S/, { message: 'reference must not be blank' })
  reference!: string;

  // Minor units. IsInt rejects floats and numeric strings (body is not coerced).
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amount!: number;

  @IsIn(CURRENCIES)
  currency!: Currency;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  customerEmail?: string;
}
