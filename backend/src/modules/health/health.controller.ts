import { Request, Response } from 'express';
import { HealthService } from './health.service';

export class HealthController {
  constructor(private readonly service: HealthService) {}

  check = async (_req: Request, res: Response): Promise<void> => {
    const result = await this.service.check();
    res.status(200).json({ ...result, timestamp: new Date().toISOString() });
  };
}
