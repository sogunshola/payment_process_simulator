import { DataSource } from 'typeorm';

export class HealthRepository {
  constructor(private readonly dataSource: DataSource) {}

  async ping(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }
}
