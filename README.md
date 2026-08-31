# AI Parent Learning Copilot

AI copilot **for parents** helping children learn Math (primary school → lower secondary).
LOCKED MVP v1.0 — Web + iOS + Android. Pilot: Grade 4 + Grade 7.

> Core invariant: **school grade is context, not a ceiling.** The engine reasons by skill,
> prerequisite, problem type, mastery, thinking demand, and actual learning frontier.

## Repository

Monorepo (npm workspaces). Project root: `Dayhoc/`.

```
apps/            web (Next.js) + mobile (Expo/RN)      — Phase 6–7
packages/
  domain         pure domain types & vocabulary        ✅ Phase 0
  schemas        Zod boundary + AI I/O contracts        ✅ Phase 0
  education-core deterministic engine (pure fns)        ✅ Phase 0 (skeleton)
  observability  structured logging + AI cost tracking  ✅ Phase 0
  math-data      Grade 4/7 curriculum + graphs          — Phase 1
  ai             replaceable LLM/OCR adapters           — Phase 2
  testing        golden test harness                    — Phase 4.5
services/        api + workers                          — Phase 2+
migrations/      node-pg-migrate (PostgreSQL)           ✅ Phase 0 baseline
docs/            planning docs (implementation/01..11)
File du an/      source-of-truth spec docs (LOCKED v1.0)
```

## Getting started

```bash
npm install
cp .env.example .env    # fill secrets; never commit .env
npm run verify          # typecheck + lint + test
```

Database migrations (needs a running Postgres + DATABASE_URL):

```bash
npm run db:migrate
npm run db:migrate:down
```

## Documentation

- Product & architecture: `docs/implementation/01..11`
- Working memory for future sessions: `CLAUDE.md`
- Locked specs: `File du an/`

## Engineering rules (summary)

TypeScript strict, no `any`. Schema validation at every boundary. Deterministic core owns
educational rules; AI only assists under validated schemas. Evidence is append-only;
derived state is recomputable. All DB changes via migrations. Golden tests gate UI expansion.
