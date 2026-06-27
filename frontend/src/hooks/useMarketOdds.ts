// ============================================================
// BOXMEOUT — useMarketOdds Hook
// Live odds hook backed by a Server-Sent Events stream.
// Falls back to a one-shot fetch for terminal markets.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { fetchOdds, type MarketOdds, type OutcomeOdds } from '../../lib/api';
import type { MarketStatus } from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Statuses where live odds are no longer meaningful */
const TERMINAL_STATUSES: MarketStatus[] = ['resolved', 'cancelled'];

export interface UseMarketOddsResult {
  odds: MarketOdds | null;
  getOutcomeOdds(outcome: 'fighter_a' | 'fighter_b' | 'draw'): OutcomeOdds | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Subscribes to live odds for a market via SSE.
 *
 * - For open/locked markets: opens an EventSource to /api/markets/:id/odds/stream
 *   and updates state on each push (server sends ~every 5 s).
 * - For terminal markets (resolved/cancelled): fetches once, no stream.
 * - Cleans up the EventSource on unmount or when marketId / status changes.
 */
export function useMarketOdds(
  marketId: string,
  status?: MarketStatus,
): UseMarketOddsResult {
  const [odds, setOdds] = useState<MarketOdds | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!marketId) return;

    setIsLoading(true);
    setError(null);

    const isTerminal = status != null && TERMINAL_STATUSES.includes(status);

    if (isTerminal) {
      // Terminal market — one-shot fetch, no stream needed
      fetchOdds(marketId)
        .then((data) => { setOdds(data as MarketOdds); setIsLoading(false); })
        .catch((err) => { setError(err instanceof Error ? err : new Error(String(err))); setIsLoading(false); });
      return;
    }

    // Live market — use SSE stream
    const es = new EventSource(`${API_BASE}/api/markets/${marketId}/odds/stream`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        setOdds(JSON.parse(event.data) as MarketOdds);
        setIsLoading(false);
      } catch {
        // malformed message — ignore
      }
    };

    es.addEventListener('error', (event: MessageEvent) => {
      try {
        const { message } = JSON.parse(event.data) as { message: string };
        setError(new Error(message));
      } catch {
        setError(new Error('Odds stream error'));
      }
      setIsLoading(false);
    });

    es.onerror = () => {
      // Network-level error (browser fires this when the connection drops)
      setError(new Error('Odds stream disconnected'));
      setIsLoading(false);
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [marketId, status]);

  return {
    odds,
    getOutcomeOdds: (outcome: 'fighter_a' | 'fighter_b' | 'draw') =>
      odds?.[outcome] ?? null,
    isLoading,
    error,
  };
}
