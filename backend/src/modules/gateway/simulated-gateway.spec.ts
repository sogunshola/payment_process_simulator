import pino from 'pino';
import { GatewayError } from './gateway.types';
import { SimulatedGateway } from './simulated-gateway';

const logger = pino({ level: 'silent' });
const config = { minLatencyMs: 0, maxLatencyMs: 0, failureRate: 0.2, declineRate: 0.1, timeoutRate: 0.05 };

// Each charge consumes two numbers: one for the latency, one for the outcome roll.
// With the rates above, rolls map to: 0.01 timeout, 0.1 decline, 0.2 transient, 0.9 approved.
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const charge = (g: SimulatedGateway, id = 'p1', signal: AbortSignal = new AbortController().signal) =>
  g.charge(id, 1000, 'NGN', signal);

describe('SimulatedGateway', () => {
  afterEach(() => jest.useRealTimers());

  it('approves with a transaction id and counts the charge', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.9));
    const res = await charge(g);
    expect(res.status).toBe('approved');
    expect(res.transactionId).toEqual(expect.any(String));
    expect(g.chargeCount('p1')).toBe(1);
  });

  it('declines', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.1));
    await expect(charge(g)).rejects.toMatchObject({ type: 'declined', message: 'Card declined' });
    expect(g.chargeCount('p1')).toBe(0);
  });

  it('fails transiently', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.2));
    const err = await charge(g).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err).toMatchObject({ type: 'transient', message: 'Gateway temporarily unavailable' });
  });

  it('hangs on a timeout roll until the signal aborts', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.01));
    const controller = new AbortController();
    let settled = false;
    const p = charge(g, 'p1', controller.signal).finally(() => {
      settled = true;
    });
    p.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    controller.abort();
    await expect(p).rejects.toMatchObject({ type: 'transient', message: 'Gateway timed out' });
  });

  it('waits for the configured latency', async () => {
    jest.useFakeTimers();
    const g = new SimulatedGateway({ ...config, minLatencyMs: 500, maxLatencyMs: 500 }, logger, sequence(0.5, 0.9));
    let done = false;
    const p = charge(g).then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('returns the same transaction for a repeat after approval and logs the duplicate', async () => {
    const info = jest.spyOn(logger, 'info');
    const g = new SimulatedGateway(config, logger, sequence(0, 0.9));
    const first = await charge(g);
    const second = await charge(g);
    expect(second.transactionId).toBe(first.transactionId);
    expect(g.chargeCount('p1')).toBe(1);
    expect(info).toHaveBeenCalledWith({ paymentId: 'p1' }, 'Duplicate charge request; returning cached result');
    info.mockRestore();
  });

  it('caches declines', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.1, 0, 0.9));
    await expect(charge(g)).rejects.toMatchObject({ type: 'declined' });
    // Would be approved if it reached the gateway again.
    await expect(charge(g)).rejects.toMatchObject({ type: 'declined' });
    expect(g.chargeCount('p1')).toBe(0);
  });

  it('does not cache transient errors, so a retry can succeed', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.2, 0, 0.9));
    await expect(charge(g)).rejects.toMatchObject({ type: 'transient' });
    await expect(charge(g)).resolves.toMatchObject({ status: 'approved' });
    expect(g.chargeCount('p1')).toBe(1);
  });

  it('does not cache timeouts', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.01, 0, 0.9));
    const controller = new AbortController();
    const first = charge(g, 'p1', controller.signal);
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(first).rejects.toMatchObject({ type: 'transient' });
    await expect(charge(g)).resolves.toMatchObject({ status: 'approved' });
  });

  it('shares one in-flight call between concurrent requests for the same payment', async () => {
    const g = new SimulatedGateway(config, logger, sequence(0, 0.9));
    const [a, b] = await Promise.all([charge(g), charge(g)]);
    expect(a.transactionId).toBe(b.transactionId);
    expect(g.chargeCount('p1')).toBe(1);
  });

  it('lets a joined caller give up on its own signal without cancelling the shared call', async () => {
    jest.useFakeTimers();
    const g = new SimulatedGateway({ ...config, minLatencyMs: 100, maxLatencyMs: 100 }, logger, sequence(0, 0.9));
    const first = charge(g);
    const impatient = new AbortController();
    const second = charge(g, 'p1', impatient.signal);
    second.catch(() => undefined);
    impatient.abort();
    await expect(second).rejects.toMatchObject({ type: 'transient', message: 'Gateway timed out' });
    await jest.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toMatchObject({ status: 'approved' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const random = jest.fn(() => 0.9);
    const g = new SimulatedGateway(config, logger, random);
    const controller = new AbortController();
    controller.abort();
    await expect(charge(g, 'p1', controller.signal)).rejects.toMatchObject({ type: 'transient' });
    expect(random).not.toHaveBeenCalled();
  });

  it('rejects during the latency wait when aborted and removes its listener and timer', async () => {
    jest.useFakeTimers();
    const g = new SimulatedGateway({ ...config, minLatencyMs: 1000, maxLatencyMs: 1000 }, logger, sequence(0, 0.9));
    const controller = new AbortController();
    const p = charge(g, 'p1', controller.signal);
    p.catch(() => undefined);
    controller.abort();
    await expect(p).rejects.toMatchObject({ type: 'transient' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns a copy from getConfig and stores a copy in setConfig', () => {
    const g = new SimulatedGateway(config, logger);
    g.getConfig().failureRate = 1;
    expect(g.getConfig().failureRate).toBe(0.2);
    const next = { ...config, failureRate: 0.5 };
    g.setConfig(next);
    next.failureRate = 0;
    expect(g.getConfig().failureRate).toBe(0.5);
  });
});
