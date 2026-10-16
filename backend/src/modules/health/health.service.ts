import { ServiceUnavailableError } from '../../common/errors';
import { HealthRepository } from './health.repository';

export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  async check(): Promise<{ status: 'ok'; database: 'up' }> {
    try {
      await this.repository.ping();
    } catch {
      // Driver message deliberately dropped; it may expose internals.
      throw new ServiceUnavailableError('Database unavailable');
    }
    return { status: 'ok', database: 'up' };
  }
}
