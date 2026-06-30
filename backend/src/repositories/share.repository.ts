/**
 * Share Repository
 *
 * Data access layer for user share holdings (positions in market outcomes).
 * Shares represent partial ownership of a market outcome and can be bought/sold via the AMM.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { pool } from '../config/db.js';
import { shares, Share, NewShare } from '../db/schema.js';
import { AppError } from '../utils/AppError.js';

const db = drizzle(pool);

export interface ShareDTO {
  id: number;
  userId: string;
  marketId: string;
  outcomeId: number;
  quantity: string;
  costBasis: string;
  realizedPnl: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Find all shares owned by a user across all markets
 */
export async function findUserShares(userId: string): Promise<Share[]> {
  return db.select().from(shares).where(eq(shares.user_id, userId));
}

/**
 * Find share for specific user-market-outcome combination
 */
export async function findShareByMarket(
  userId: string,
  marketId: string,
  outcomeId: number
): Promise<Share | null> {
  const result = await db
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.user_id, userId),
        eq(shares.market_id, marketId),
        eq(shares.outcome_id, outcomeId)
      )
    )
    .limit(1);

  return result[0] || null;
}

/**
 * Create a new share position
 */
export async function createShare(data: {
  userId: string;
  marketId: string;
  outcomeId: number;
  quantity: string;
  costBasis: string;
}): Promise<Share> {
  const result = await db
    .insert(shares)
    .values({
      user_id: data.userId,
      market_id: data.marketId,
      outcome_id: data.outcomeId,
      quantity: data.quantity,
      cost_basis: data.costBasis,
      realized_pnl: '0',
    })
    .returning();

  if (!result[0]) {
    throw new AppError(500, 'Failed to create share');
  }

  return result[0];
}

/**
 * Update share quantity and optionally realized P&L
 */
export async function updateShareQuantity(
  shareId: number,
  quantity: string,
  realizedPnl?: string
): Promise<Share> {
  const updateData: any = { quantity };
  if (realizedPnl !== undefined) {
    updateData.realized_pnl = realizedPnl;
  }

  const result = await db
    .update(shares)
    .set(updateData)
    .where(eq(shares.id, shareId))
    .returning();

  if (!result[0]) {
    throw new AppError(500, 'Failed to update share');
  }

  return result[0];
}

/**
 * Delete a share position
 */
export async function deleteShare(shareId: number): Promise<void> {
  const result = await db.delete(shares).where(eq(shares.id, shareId)).returning();

  if (!result[0]) {
    throw new AppError(404, 'Share not found');
  }
}

/**
 * Get total quantity of shares for user in specific market across all outcomes
 */
export async function getUserMarketShares(
  userId: string,
  marketId: string
): Promise<Share[]> {
  return db
    .select()
    .from(shares)
    .where(and(eq(shares.user_id, userId), eq(shares.market_id, marketId)));
}

/**
 * Get user's total portfolio value (sum of quantity * estimated price)
 * Note: This is a basic calculation; actual price should come from AMM
 */
export async function getUserPortfolioShares(userId: string): Promise<Share[]> {
  return db.select().from(shares).where(eq(shares.user_id, userId));
}
