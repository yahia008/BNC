-- Verification script for bets table indexes
-- Run with: psql -d your_database -f backend/scripts/verify-bets-indexes.sql

-- 1. List all indexes on bets table
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'bets'
ORDER BY indexname;

-- 2. Verify bettor_address index usage
-- Query: Get all bets for a specific bettor
EXPLAIN ANALYZE
SELECT * FROM bets 
WHERE bettor_address = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
LIMIT 100;

-- 3. Verify composite (market_id, claimed) index usage
-- Query: Get unclaimed bets for a specific market (used in claim/dispute operations)
EXPLAIN ANALYZE
SELECT * FROM bets 
WHERE market_id = 'market_123' 
  AND claimed = false;

-- 4. Verify composite index for counting unclaimed bets per market
EXPLAIN ANALYZE
SELECT market_id, COUNT(*) as unclaimed_count
FROM bets
WHERE claimed = false
GROUP BY market_id;

-- 5. Check index sizes and usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'bets'
ORDER BY indexname;
