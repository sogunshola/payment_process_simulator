import { Router } from 'express';

/** What every feature module hands to createApp(). */
export interface AppModule {
  router: Router;
}
