# Quick Start: Apply Index Optimizations

## TL;DR
Run this to apply the new composite index on bets table:

```bash
cd backend
npm run migrate
```

## What This Does
Adds `bets_market_id_claimed_idx` composite index on `(market_id, claimed)` to optimize:
- Payout claim queries
- Dispute resolution queries
- Unclaimed bet lookups

## Verify It Worked
```bash
# Connect to your database
psql -d your_database

# Check the index exists
\d bets

# You should see:
# "bets_market_id_claimed_idx" btree (market_id, claimed)
```

## Test Query Performance
```sql
-- This should use the new composite index
EXPLAIN ANALYZE
SELECT * FROM bets 
WHERE market_id = 'your_market_id' 
  AND claimed = false;

-- Look for: "Index Scan using bets_market_id_claimed_idx"
```

## Index Summary
After this migration, the `bets` table will have:
1. ✅ `bets_bettor_address_idx` - Portfolio queries (already existed)
2. ✅ `bets_market_id_claimed_idx` - Unclaimed bets per market (NEW)
3. ✅ `bets_market_id_idx` - Market lookups (already existed)
4. ✅ `bets_tx_hash_idx` - Transaction hash lookups (already existed)

All major query patterns are now optimized!
