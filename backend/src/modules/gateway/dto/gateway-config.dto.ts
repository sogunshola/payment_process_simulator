import {
  IsInt,
  IsNumber,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Cross-field rules live in constraints so their errors use the same
// {field, message} shape as every other validation failure. They pass when the
// inputs are not numbers: the per-field decorators already report those.
@ValidatorConstraint({ name: 'maxNotBelowMin', async: false })
class MaxNotBelowMin implements ValidatorConstraintInterface {
  validate(max: unknown, args: ValidationArguments): boolean {
    const min = (args.object as GatewayConfigDto).minLatencyMs;
    return typeof max !== 'number' || typeof min !== 'number' || max >= min;
  }
  defaultMessage(): string {
    return 'maxLatencyMs must be greater than or equal to minLatencyMs';
  }
}

@ValidatorConstraint({ name: 'ratesSumAtMostOne', async: false })
class RatesSumAtMostOne implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as GatewayConfigDto;
    const rates = [o.failureRate, o.declineRate, o.timeoutRate];
    if (!rates.every((r) => typeof r === 'number')) return true;
    return rates.reduce((a, b) => a + b, 0) <= 1 + 1e-9;
  }
  defaultMessage(): string {
    return 'failureRate + declineRate + timeoutRate must be less than or equal to 1';
  }
}

// PUT replaces the whole config, so every field is required.
export class GatewayConfigDto {
  @IsInt()
  @Min(0)
  @Max(10_000)
  minLatencyMs!: number;

  @IsInt()
  @Min(0)
  @Max(10_000)
  @Validate(MaxNotBelowMin)
  maxLatencyMs!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  failureRate!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  declineRate!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  @Validate(RatesSumAtMostOne)
  timeoutRate!: number;
}
