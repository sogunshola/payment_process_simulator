import { Logger } from '../../common/logger';
import { AppModule } from '../../common/types';
import { GatewayController } from './gateway.controller';
import { GatewayConfig } from './gateway.types';
import { createGatewayRouter } from './gateway.routes';
import { SimulatedGateway } from './simulated-gateway';

export function createGatewayModule(
  config: GatewayConfig,
  logger: Logger,
): AppModule & { gateway: SimulatedGateway } {
  const gateway = new SimulatedGateway(config, logger);
  const controller = new GatewayController(gateway, logger);
  return { router: createGatewayRouter(controller), gateway };
}
