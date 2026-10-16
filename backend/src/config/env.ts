import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
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
}

const isBlank = (v: unknown) => v === undefined || v === '';

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
 * API_KEY and CORS_ORIGINS are validated now but only consumed by later
 * modules (auth middleware, CORS); failing fast here avoids a late surprise.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const vars = plainToInstance(EnvVars, {
    PORT: env.PORT,
    DB_PATH: env.DB_PATH,
    API_KEY: env.API_KEY,
    CORS_ORIGINS: env.CORS_ORIGINS,
    NODE_ENV: env.NODE_ENV,
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

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
  }

  return Object.freeze({
    port: vars.PORT,
    dbPath: vars.DB_PATH,
    apiKey: vars.API_KEY,
    corsOrigins: Object.freeze(origins),
    nodeEnv: vars.NODE_ENV,
  });
}
