import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CreatePaymentInput, GatewayConfig, PaymentListParams, UpdateStatusInput } from './types';

const LIVE = 1000;

export const keys = {
  payments: ['payments'] as const,
  list: (p: PaymentListParams) => ['payments', 'list', p] as const,
  one: (id: string) => ['payments', 'one', id] as const,
  stats: ['payments', 'stats'] as const,
  gateway: ['gateway'] as const,
  health: ['health'] as const,
};

export const usePayments = (params: PaymentListParams = {}) =>
  useQuery({
    queryKey: keys.list(params),
    queryFn: () => api.listPayments(params),
    refetchInterval: LIVE,
    placeholderData: keepPreviousData,
  });

export const usePayment = (id: string | undefined) =>
  useQuery({
    queryKey: keys.one(id ?? ''),
    queryFn: () => api.getPayment(id as string),
    enabled: !!id,
    refetchInterval: LIVE,
  });

export const usePaymentStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: api.getStats, refetchInterval: LIVE });

export const useGatewayConfig = () =>
  useQuery({ queryKey: keys.gateway, queryFn: api.getGatewayConfig, refetchInterval: LIVE });

// 5s, not 1s: the backend rate-limits per IP and every other poll shares that budget.
export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 5000 });

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePaymentInput) => api.createPayment(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.payments }),
  });
}

export function useUpdatePaymentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string } & UpdateStatusInput) => {
      const { id, ...body } = v;
      return api.updatePaymentStatus(id, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.payments }),
  });
}

export function useUpdateGatewayConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GatewayConfig) => api.updateGatewayConfig(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.gateway }),
  });
}
