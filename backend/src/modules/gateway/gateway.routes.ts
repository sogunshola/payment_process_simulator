import { Router } from 'express';
import { validate } from '../../common/middleware/validate';
import { GatewayConfigDto } from './dto/gateway-config.dto';
import { GatewayController } from './gateway.controller';

export function createGatewayRouter(controller: GatewayController): Router {
  const router = Router();
  router.get('/gateway/config', controller.getConfig);
  router.put('/gateway/config', validate(GatewayConfigDto, 'body'), controller.setConfig);
  return router;
}
