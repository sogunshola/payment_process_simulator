import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retrying a 4xx (bad key, validation, not found) cannot succeed and only burns rate limit.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        // Background polling pauses when the tab is hidden (the TanStack default), which spares the rate limit.
        refetchIntervalInBackground: false,
      },
      mutations: { retry: 0 },
    },
  });
}
