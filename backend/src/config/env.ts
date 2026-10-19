import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { plainToInstance, Transform } from 'class-transformer';

export type NodeEnvName = 'development' | 'test' | 'production';

export interface AppConfig {
  readonly port: number;
  readonly dbPath: string;
  readonly apiKey: string;
  readonly corsOrigins: readonly string[];
  readonly nodeEnv: NodeEnvName;
  readonly rateLimit: {
    readonly windowMs: number;
    readonly max: number;
    readonly createMax: number;
  };
  readonly gateway: {
    readonly minLatencyMs: number;
    readonly maxLatencyMs: number;
    readonly failureRate: number;
    readonly declineRate: number;
    readonly timeoutRate: number;
  };
  readonly processor: {
    readonly gatewayTimeoutMs: number;
    readonly concurrency: number;
    readonly maxAttempts: number;
  };
  readonly redisUrl: string;
}

// Must equal the API_KEY value in .env.example (keep them in sync). Production refuses to
// boot with it, so a copied-but-unedited .env cannot ship with a publicly known key.
export const PLACEHOLDER_API_KEY = 'replace-me-with-a-long-random-secret';

const isBlank = (v: unknown) => v === undefined || v === '';
// Blank means "use the default"; anything else is converted and left to the validators
// (Number('abc') is NaN, which IsInt/IsNumber reject).
const numberOr =
  (def: number) =>
  ({ value }: { value: unknown }) =>
    isBlank(value) ? def : Number(value);

class EnvVars {
  @Transform(({ value }: { value: unknown }) => (isBlank(value) ? 3000 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @Transform(({ value }: { value: unknown }) => (isBlank(value) ? 'payments.sqlite' : value))
  @IsString()
  @IsNotEmpty()
  DB_PATH!: string;

  // No default on purpose: a missing secret must stop the service.
  @IsString()
  @MinLength(16)
  API_KEY!: string;

  @Transform(({ value }: { value: unknown }) => (isBlank(value) ? 'http://localhost:5173' : value))
  @IsString()
  CORS_ORIGINS!: string;

  @Transform(({ value }: { value: unknown }) => (isBlank(value) ? 'development' : value))
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: NodeEnvName;

  @Transform(numberOr(60_000))
  @IsInt()
  @Min(1000)
  @Max(3_600_000)
  RATE_LIMIT_WINDOW_MS!: number;

  @Transform(numberOr(300))
  @IsInt()
  @Min(1)
  @Max(100_000)
  RATE_LIMIT_MAX!: number;

  @Transform(numberOr(30))
  @IsInt()
  @Min(1)
  @Max(100_000)
  RATE_LIMIT_CREATE_MAX!: number;

  @Transform(numberOr(100))
  @IsInt()
  @Min(0)
  @Max(10_000)
  GATEWAY_MIN_LATENCY_MS!: number;

  @Transform(numberOr(800))
  @IsInt()
  @Min(0)
  @Max(10_000)
  GATEWAY_MAX_LATENCY_MS!: number;

  @Transform(numberOr(0.2))
  @IsNumber()
  @Min(0)
  @Max(1)
  GATEWAY_FAILURE_RATE!: number;

  @Transform(numberOr(0.1))
  @IsNumber()
  @Min(0)
  @Max(1)
  GATEWAY_DECLINE_RATE!: number;

  @Transform(numberOr(0.05))
  @IsNumber()
  @Min(0)
  @Max(1)
  GATEWAY_TIMEOUT_RATE!: number;

  @Transform(numberOr(5000))
  @IsInt()
  @Min(100)
  @Max(60_000)
  GATEWAY_TIMEOUT_MS!: number;

  // Payments charged in parallel by this process.
  @Transform(numberOr(10))
  @IsInt()
  @Min(1)
  @Max(100)
  PROCESSOR_CONCURRENCY!: number;

  @Transform(numberOr(5))
  @IsInt()
  @Min(1)
  @Max(20)
  PROCESSOR_MAX_ATTEMPTS!: number;

  // Message names the variable only: the URL may carry a password.
  @Transform(({ value }: { value: unknown }) => (isBlank(value) ? 'redis://localhost:6379' : value))
  @IsString()
  @Matches(/^rediss?:\/\/\S+$/, { message: 'REDIS_URL must be a redis:// or rediss:// URL' })
  REDIS_URL!: string;
}

function parseOrigins(raw: string): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      const url = new URL(item);
      // An origin has no path/query; comparing to url.origin rejects "http://a/b".
      const ok = (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === item;
      (ok ? origins : invalid).push(item);
    } catch {
      invalid.push(item);
    }
  }
  return { origins, invalid };
}

/**
 * Pure function of `env`: dotenv is loaded in server.ts, not here, so tests
 * stay deterministic and never pick up a developer's local .env.
 *
 * server.ts calls this at boot, so every rule here (including the production
 * placeholder-key check) is a fail-fast startup rule.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const vars = plainToInstance(EnvVars, {
    PORT: env.PORT,
    DB_PATH: env.DB_PATH,
    API_KEY: env.API_KEY,
    CORS_ORIGINS: env.CORS_ORIGINS,
    NODE_ENV: env.NODE_ENV,
    RATE_LIMIT_WINDOW_MS: env.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX: env.RATE_LIMIT_MAX,
    RATE_LIMIT_CREATE_MAX: env.RATE_LIMIT_CREATE_MAX,
    GATEWAY_MIN_LATENCY_MS: env.GATEWAY_MIN_LATENCY_MS,
    GATEWAY_MAX_LATENCY_MS: env.GATEWAY_MAX_LATENCY_MS,
    GATEWAY_FAILURE_RATE: env.GATEWAY_FAILURE_RATE,
    GATEWAY_DECLINE_RATE: env.GATEWAY_DECLINE_RATE,
    GATEWAY_TIMEOUT_RATE: env.GATEWAY_TIMEOUT_RATE,
    GATEWAY_TIMEOUT_MS: env.GATEWAY_TIMEOUT_MS,
    PROCESSOR_CONCURRENCY: env.PROCESSOR_CONCURRENCY,
    PROCESSOR_MAX_ATTEMPTS: env.PROCESSOR_MAX_ATTEMPTS,
    REDIS_URL: env.REDIS_URL,
  });

  const problems: string[] = [];
  for (const err of validateSync(vars)) {
    // Only constraint text is reported; the offending value (e.g. the API key) never is.
    for (const msg of Object.values(err.constraints ?? {})) problems.push(msg);
  }

  const { origins, invalid } = parseOrigins(vars.CORS_ORIGINS ?? '');
  if (typeof vars.CORS_ORIGINS === 'string') {
    if (invalid.length > 0) {
      problems.push(
        `CORS_ORIGINS contains invalid origin(s): ${invalid.join(', ')} (expected e.g. https://example.com, no path)`,
      );
    }
    if (origins.length === 0 && invalid.length === 0) {
      problems.push('CORS_ORIGINS must contain at least one origin');
    }
  }

  // Cross-field rules only make sense once each field is individually valid.
  if (problems.length === 0) {
    if (vars.GATEWAY_MIN_LATENCY_MS > vars.GATEWAY_MAX_LATENCY_MS) {
      problems.push('GATEWAY_MIN_LATENCY_MS must be <= GATEWAY_MAX_LATENCY_MS');
    }
    // The three outcomes share one random roll, so their rates must fit in [0, 1].
    const rateSum = vars.GATEWAY_FAILURE_RATE + vars.GATEWAY_DECLINE_RATE + vars.GATEWAY_TIMEOUT_RATE;
    if (rateSum > 1 + 1e-9) {
      problems.push('GATEWAY_FAILURE_RATE + GATEWAY_DECLINE_RATE + GATEWAY_TIMEOUT_RATE must be <= 1');
    }
  }

  // Message names the variable only, never the value.
  if (vars.NODE_ENV === 'production' && vars.API_KEY === PLACEHOLDER_API_KEY) {
    problems.push('API_KEY is still the placeholder from .env.example; set a real secret in production');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
  }

  return Object.freeze({
    port: vars.PORT,
    dbPath: vars.DB_PATH,
    apiKey: vars.API_KEY,
    corsOrigins: Object.freeze(origins),
    nodeEnv: vars.NODE_ENV,
    rateLimit: Object.freeze({
      windowMs: vars.RATE_LIMIT_WINDOW_MS,
      max: vars.RATE_LIMIT_MAX,
      createMax: vars.RATE_LIMIT_CREATE_MAX,
    }),
    gateway: Object.freeze({
      minLatencyMs: vars.GATEWAY_MIN_LATENCY_MS,
      maxLatencyMs: vars.GATEWAY_MAX_LATENCY_MS,
      failureRate: vars.GATEWAY_FAILURE_RATE,
      declineRate: vars.GATEWAY_DECLINE_RATE,
      timeoutRate: vars.GATEWAY_TIMEOUT_RATE,
    }),
    processor: Object.freeze({
      gatewayTimeoutMs: vars.GATEWAY_TIMEOUT_MS,
      concurrency: vars.PROCESSOR_CONCURRENCY,
      maxAttempts: vars.PROCESSOR_MAX_ATTEMPTS,
    }),
    redisUrl: vars.REDIS_URL,
  });
}
