/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Add composite index on (market_id, claimed) for optimizing unclaimed bets queries
  pgm.createIndex('bets', ['market_id', 'claimed'], {
    name: 'bets_market_id_claimed_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('bets', ['market_id', 'claimed'], {
    name: 'bets_market_id_claimed_idx',
  });
};
