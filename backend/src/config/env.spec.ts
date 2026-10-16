import { loadConfig } from './env';

const KEY = 'a-very-secret-key-1234';
const valid = { API_KEY: KEY };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(valid);
    expect(c).toEqual({
      port: 3000,
      dbPath: 'payments.sqlite',
      apiKey: KEY,
      corsOrigins: ['http://localhost:5173'],
      nodeEnv: 'development',
      gateway: { minLatencyMs: 100, maxLatencyMs: 800, failureRate: 0.2, declineRate: 0.1, timeoutRate: 0.05 },
      processor: { gatewayTimeoutMs: 5000, pollIntervalMs: 1000, batchSize: 10, maxAttempts: 5 },
    });
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('parses explicit values and multiple origins', () => {
    const c = loadConfig({
      ...valid,
      PORT: '8080',
      DB_PATH: ':memory:',
      NODE_ENV: 'test',
      CORS_ORIGINS: 'https://a.example.com, http://localhost:5173',
    });
    expect(c.port).toBe(8080);
    expect(c.dbPath).toBe(':memory:');
    expect(c.nodeEnv).toBe('test');
    expect(c.corsOrigins).toEqual(['https://a.example.com', 'http://localhost:5173']);
  });

  it('fails when API_KEY is missing', () => {
    expect(() => loadConfig({})).toThrow(/API_KEY/);
  });

  it('fails when API_KEY is too short', () => {
    expect(() => loadConfig({ API_KEY: 'short' })).toThrow(/API_KEY/);
  });

  it.each(['abc', '0', '70000', '3.5'])('fails on bad PORT %s', (PORT) => {
    expect(() => loadConfig({ ...valid, PORT })).toThrow(/PORT/);
  });

  it('fails on bad NODE_ENV', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it.each(['not-a-url', 'ftp://example.com', 'http://example.com/path'])(
    'fails on bad CORS origin %s',
    (CORS_ORIGINS) => {
      expect(() => loadConfig({ ...valid, CORS_ORIGINS })).toThrow(/CORS_ORIGINS/);
    },
  );

  it('parses explicit gateway and processor values', () => {
    const c = loadConfig({
      ...valid,
      GATEWAY_MIN_LATENCY_MS: '0',
      GATEWAY_MAX_LATENCY_MS: '10',
      GATEWAY_FAILURE_RATE: '0.5',
      GATEWAY_DECLINE_RATE: '0.25',
      GATEWAY_TIMEOUT_RATE: '0.25',
      GATEWAY_TIMEOUT_MS: '200',
      PROCESSOR_POLL_INTERVAL_MS: '150',
      PROCESSOR_BATCH_SIZE: '3',
      PROCESSOR_MAX_ATTEMPTS: '2',
    });
    expect(c.gateway).toEqual({
      minLatencyMs: 0,
      maxLatencyMs: 10,
      failureRate: 0.5,
      declineRate: 0.25,
      timeoutRate: 0.25,
    });
    expect(c.processor).toEqual({ gatewayTimeoutMs: 200, pollIntervalMs: 150, batchSize: 3, maxAttempts: 2 });
  });

  it.each([
    ['GATEWAY_FAILURE_RATE', '1.5'],
    ['GATEWAY_DECLINE_RATE', '-0.1'],
    ['GATEWAY_TIMEOUT_RATE', 'abc'],
    ['GATEWAY_MIN_LATENCY_MS', '10001'],
    ['GATEWAY_MAX_LATENCY_MS', '1.5'],
    ['GATEWAY_TIMEOUT_MS', '99'],
    ['PROCESSOR_POLL_INTERVAL_MS', '60001'],
    ['PROCESSOR_BATCH_SIZE', '0'],
    ['PROCESSOR_BATCH_SIZE', '101'],
    ['PROCESSOR_MAX_ATTEMPTS', '21'],
  ])('fails on bad %s=%s', (name, value) => {
    expect(() => loadConfig({ ...valid, [name]: value })).toThrow(new RegExp(name));
  });

  it('fails when the failure rates sum to more than 1', () => {
    expect(() =>
      loadConfig({
        ...valid,
        GATEWAY_FAILURE_RATE: '0.5',
        GATEWAY_DECLINE_RATE: '0.4',
        GATEWAY_TIMEOUT_RATE: '0.2',
      }),
    ).toThrow(/must be <= 1/);
  });

  it('fails when min latency exceeds max latency', () => {
    expect(() =>
      loadConfig({ ...valid, GATEWAY_MIN_LATENCY_MS: '500', GATEWAY_MAX_LATENCY_MS: '100' }),
    ).toThrow(/GATEWAY_MIN_LATENCY_MS must be <= GATEWAY_MAX_LATENCY_MS/);
  });

  it('lists every problem at once and never prints the API key', () => {
    const secret = 'short-secret';
    let message = '';
    try {
      loadConfig({ API_KEY: secret, PORT: 'x', NODE_ENV: 'nope', CORS_ORIGINS: 'bad' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/API_KEY/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/NODE_ENV/);
    expect(message).toMatch(/CORS_ORIGINS/);
    expect(message).not.toContain(secret);
  });
});
