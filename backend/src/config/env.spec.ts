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
