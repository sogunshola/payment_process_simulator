import { Router } from 'express';
import { HealthController } from './health.controller';

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.get('/health', controller.check);
  return router;
}
