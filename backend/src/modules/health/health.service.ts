import { ServiceUnavailableError } from '../../common/errors';
import { HealthRepository } from './health.repository';

export class HealthService {
  constructor(
    private readonly repository: HealthRepository,
    private readonly pingRedis?: () => Promise<void>,
  ) {}

  async check(): Promise<{ status: 'ok'; database: 'up'; redis?: 'up' | 'down' }> {
    try {
      await this.repository.ping();
    } catch {
      // Driver message deliberately dropped; it may expose internals.
      throw new ServiceUnavailableError('Database unavailable');
    }
    if (!this.pingRedis) return { status: 'ok', database: 'up' };
    // Redis down is reported but is not a 503: the API still accepts payments (the database
    // is the source of truth) and they are queued again on the next boot.
    const redis = await this.pingRedis().then(
      () => 'up' as const,
      () => 'down' as const,
    );
    return { status: 'ok', database: 'up', redis };
  }
}
