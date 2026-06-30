-- Test queries to demonstrate index usage
-- Run these with EXPLAIN ANALYZE to see execution plans

-- ============================================================================
-- Query 1: Portfolio Query - Uses bets_bettor_address_idx
-- ============================================================================
-- Use case: GET /bets/:address endpoint, user portfolio page
-- Expected: Index Scan using bets_bettor_address_idx

EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    b.id,
    b.market_id,
    b.side,
    b.amount,
    b.placed_at,
    b.claimed,
    b.payout,
    m.fighter_a,
    m.fighter_b,
    m.status,
    m.outcome
FROM bets b
JOIN markets m ON b.market_id = m.market_id
WHERE b.bettor_address = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
ORDER BY b.placed_at DESC
LIMIT 50;

-- ============================================================================
-- Query 2: Unclaimed Bets for Market - Uses bets_market_id_claimed_idx (NEW)
-- ============================================================================
-- Use case: Claim processing, dispute validation, payout calculations
-- Expected: Index Scan using bets_market_id_claimed_idx

EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    bettor_address,
    side,
    amount,
    placed_at
FROM bets
WHERE market_id = 'market_123'
  AND claimed = false;

-- ============================================================================
-- Query 3: Count Unclaimed Bets - Uses bets_market_id_claimed_idx (NEW)
-- ============================================================================
-- Use case: Validation before market resolution
-- Expected: Index Only Scan using bets_market_id_claimed_idx

EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) as unclaimed_count
FROM bets
WHERE market_id = 'market_123'
  AND claimed = false;

-- ============================================================================
-- Query 4: Unclaimed Bets by Side - Uses bets_market_id_claimed_idx (NEW)
-- ============================================================================
-- Use case: Calculating potential payouts per side
-- Expected: Index Scan using bets_market_id_claimed_idx

EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    side,
    COUNT(*) as bet_count,
    SUM(amount) as total_amount
FROM bets
WHERE market_id = 'market_123'
  AND claimed = false
GROUP BY side;

-- ============================================================================
-- Query 5: Recent Unclaimed Bets - Uses bets_market_id_claimed_idx (NEW)
-- ============================================================================
-- Use case: Admin dashboard, dispute investigation
-- Expected: Index Scan using bets_market_id_claimed_idx

EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    b.bettor_address,
    b.side,
    b.amount,
    b.placed_at,
    b.tx_hash
FROM bets b
WHERE b.market_id = 'market_123'
  AND b.claimed = false
ORDER BY b.placed_at DESC;

-- ============================================================================
-- Query 6: User's Unclaimed Bets - Uses multiple indexes
-- ============================================================================
-- Use case: "My Pending Claims" page
-- Expected: May use bets_bettor_address_idx or bitmap index scan

EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    b.market_id,
    m.fighter_a,
    m.fighter_b,
    b.side,
    b.amount,
    b.placed_at,
    m.status,
    m.outcome
FROM bets b
JOIN markets m ON b.market_id = m.market_id
WHERE b.bettor_address = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
  AND b.claimed = false
ORDER BY b.placed_at DESC;

-- ============================================================================
-- Performance Comparison: Before vs After
-- ============================================================================
-- Run these on a table with 100k+ rows to see the difference

-- Query that benefits from composite index
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT * FROM bets
WHERE market_id = 'market_123' AND claimed = false;

-- Note the execution time and compare with:
-- Before: Seq Scan on bets (10-500ms depending on table size)
-- After: Index Scan using bets_market_id_claimed_idx (1-10ms)
