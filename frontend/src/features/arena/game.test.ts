import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaGame, type Snapshot } from './game';

const SNAPSHOT = { minLatencyMs: 10, maxLatencyMs: 20, failureRate: 0, declineRate: 0, timeoutRate: 0 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let posts: number[];
let postStatus: number;
let patchStatus: number;

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  posts = [];
  postStatus = 201;
  patchStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = String(url).replace(/^\/api/, '');
      const method = init.method ?? 'GET';
      if (path === '/gateway/config') return json(method === 'GET' ? SNAPSHOT : JSON.parse(String(init.body)));
      if (path === '/payments' && method === 'POST') {
        posts.push(Date.now());
        return postStatus === 201
          ? json({ id: `id-${posts.length}`, amount: 1000, currency: 'USD', status: 'PENDING', attempts: 0, failureReason: null }, 201)
          : json({ message: 'slow down' }, postStatus);
      }
      if (path.startsWith('/payments?')) {
        const data = posts.map((_, i) => ({ id: `id-${i + 1}`, status: 'PENDING', attempts: 3, failureReason: null }));
        return json({ data, page: 1, limit: 100, total: data.length });
      }
      if (method === 'PATCH') return patchStatus === 200 ? json({}) : json({ message: 'conflict' }, patchStatus);
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  let last: Snapshot | null = null;
  const game = new ArenaGame((s) => (last = s), vi.fn());
  const logText = () => (last as Snapshot | null)?.log.map((l) => l.text).join('\n') ?? '';
  return { game, logText };
}

describe('ArenaGame', () => {
  it('on a 429 logs it, skips the spawn and doubles the interval, without retrying at once', async () => {
    postStatus = 429;
    const { game, logText } = setup();
    await game.start(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(posts).toHaveLength(1);
    expect(logText()).toContain('Intake throttled by API (429)');
    // Normal interval is 2.5 s; doubled it is 5 s, so nothing may be sent at +2.5 s.
    await vi.advanceTimersByTimeAsync(3000);
    expect(posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(posts).toHaveLength(2);
    game.dispose();
  });

  it('logs a 409 on cancel as "too late"', async () => {
    patchStatus = 409;
    const { game, logText } = setup();
    await game.start(false);
    await vi.advanceTimersByTimeAsync(1500); // one spawn, one poll showing attempts 3
    game.usePower('cancel');
    await vi.advanceTimersByTimeAsync(10);
    expect(logText()).toContain('too late, processor grabbed it');
    expect(logText()).toContain('Cancel doomed: 0 of 1');
    game.dispose();
  });

  it('does not use the cancel power or start a cooldown when nothing is doomed', async () => {
    const { game, logText } = setup();
    await game.start(false);
    game.usePower('cancel');
    expect(logText()).toContain('No doomed payments');
    game.dispose();
  });
});
