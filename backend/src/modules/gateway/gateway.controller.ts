import { Request, Response } from 'express';
import { Logger } from '../../common/logger';
import { GatewayConfigDto } from './dto/gateway-config.dto';
import { SimulatedGateway } from './simulated-gateway';

export class GatewayController {
  constructor(
    private readonly gateway: SimulatedGateway,
    private readonly logger: Logger,
  ) {}

  getConfig = (_req: Request, res: Response): void => {
    res.status(200).json(this.gateway.getConfig());
  };

  setConfig = (req: Request, res: Response): void => {
    const dto = req.validated?.body as GatewayConfigDto;
    const previous = this.gateway.getConfig();
    this.gateway.setConfig({
      minLatencyMs: dto.minLatencyMs,
      maxLatencyMs: dto.maxLatencyMs,
      failureRate: dto.failureRate,
      declineRate: dto.declineRate,
      timeoutRate: dto.timeoutRate,
    });
    const current = this.gateway.getConfig();
    this.logger.info({ previous, current }, 'Gateway config updated');
    res.status(200).json(current);
  };
}
