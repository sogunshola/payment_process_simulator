import { Router } from 'express';

/** What every feature module hands to createApp(). */
export interface AppModule {
  router: Router;
  /** Mounted before API-key auth (e.g. health checks). Everything else is protected. */
  public?: boolean;
}
