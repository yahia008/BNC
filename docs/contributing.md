# Contributing to BoxMeOut

Thank you for your interest in contributing to BoxMeOut! This document provides guidelines for development and deployment.

## Development Setup

See [Quick Start](./QUICK_START.md) for local development environment setup.

## Code Standards

- Use TypeScript for all new code
- Follow ESLint configuration (run `npm run lint`)
- Write tests for new features
- Keep commit messages clear and descriptive

## Migration Safety Guidelines

To ensure safe deployments and zero-downtime operations, follow these migration rules:

1. **Never Drop/Truncate/Rename Objects in a Single Deployment**
   - Avoid DROP COLUMN, DROP TABLE, TRUNCATE, or RENAME operations in migrations
   - If you must remove a column, first deploy code that stops reading/writing it, then deploy a migration to drop it in a separate release
2. **Backward Compatibility First**
   - All migrations must be compatible with the previous version of the code
   - For schema changes, ensure new columns have defaults or allow NULLs initially
3. **Use the Migration Checker**
   - Before committing migrations, run `npm run migrate:check` to catch destructive operations
   - Use `npm run migrate:dry-run` to preview pending migrations
4. **Test Migrations**
   - Run migrations locally against a copy of production-like schema
   - Test rollbacks whenever possible
5. **Review Required**
   - Any destructive migration requires explicit approval in PR review

## Deployment

### Contract Deployment

```bash
cd contracts
export ADMIN_SECRET_KEY=S...
export STELLAR_RPC_URL=https://soroban-testnet.stellar.org  # Optional: custom RPC
./scripts/deploy.sh testnet
```

See `scripts/deploy.sh` for environment variable options and custom RPC node support.

### Frontend Deployment

```bash
cd frontend
npm run build
# Deploy dist/ to hosting provider
```

### Backend Deployment

```bash
cd backend
npm run build
# Deploy to your hosting provider
```

## Production Operations

When deploying to production, refer to the [Operational Runbook](./runbook.md) for:

- **Incident Response Procedures** — Step-by-step guides for common production incidents
- **Oracle Failure Handling** — Resolution procedures for unresolved markets
- **Treasury Management** — Withdrawal limit adjustments and emergency drainage
- **Contract Pause Operations** — Emergency pause and resume procedures
- **RPC Node Troubleshooting** — Diagnosis and recovery from blockchain connectivity issues
- **CLI Commands** — Quick reference for critical operations

## Testing

```bash
# Frontend tests
cd frontend
npm run test

# Backend tests
cd backend
npm run test

# Contract tests
cd contracts
cargo test

# Check migrations
cd backend
npm run migrate:check
npm run migrate:dry-run
```

## Reporting Issues

Please use GitHub Issues with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (testnet/mainnet, git commit, browser/node version)

## License

All contributions are licensed under the MIT License.
