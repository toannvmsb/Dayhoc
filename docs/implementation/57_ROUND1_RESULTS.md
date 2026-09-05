# 57 — Round 1 results (doc 56 §2, re-run after fixes)

> **STOP point (doc 56 §10). Reporting Round 1; NOT proceeding to Round 2.**

6 specs (`BENCH-LT-G4-02` basic · `BENCH-LT-G4-03` application · `HC01` G4
thinking · `BENCH-LT-G7-06` G7 application · `HC05` G7 gap/frontier safety ·
`HC10` G7 HSG K5) × MODE A (1 item/call) × 1 retry × no fallback × no gpt-4o.

Spend: buggy first run **$0.1225** + re-run **$0.230** (gpt-4o-mini $0.023 +
gpt-4.1-mini $0.080 + gpt-5-mini $0.127) = **~$0.35 cumulative**. Hard cap
$0.50 per run; the per-call guardrail was never hit.

Raw: `ROUND1_all.txt` (gitignored).

## Comparison

| metric | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| structured output mode | STRICT ✅ | STRICT ✅ | STRICT ✅ |
| schema pass (calls) | 100% (81/81) | 100% (83/83) | 100% (67/67) |
| skill alignment | 100% | 100% | 100% |
| curriculum / prerequisite safety | 100% / 100% | 100% / 100% | 100% / 100% |
| K / T conformity | 100% / 100% | 100% / 100% | 100% / 100% |
| leakage pass | 87.9% | 94.8% | 94.8% |
| within-worksheet uniqueness | 98.3% | 100% | 100% |
| **deterministic-verifier coverage** | 4.9% (2/41) | 0.0% (0/46) | 2.2% (1/46) |
| deterministic-correct (of ruled) | 100% | n/a | 100% |
| deterministic-wrong | 0% | 0% | 0% |
| crosscheck-required (of content-accepted) | 95.7% | 100% | 98.2% |
| **CONTENT first-pass acceptance** | 60.3% | 56.9% | **84.5%** |
| **CONTENT after 1 retry** | 81.0% | **94.8%** | **94.8%** |
| PRODUCTION-ready first-pass | 3.4% | 0% | 1.7% |
| PRODUCTION-ready after 1 retry | 3.4% | 0% | 1.7% |
| retries total / avg | 23 / 0.40 | 25 / 0.43 | **9 / 0.16** |
| latency p50 / p95 ms | **2268 / 2914** | 4557 / 7628 | 9721 / 16779 |
| tokens in / out | 79k / 19k | 81k / 30k | 65k / 55k |
| total cost | **$0.0232** | $0.0800 | $0.1270 |
| **cost / CONTENT item** | **13 VND** | 38 VND | 60 VND |
| cost / PRODUCTION item | 301 VND | — | 3302 VND |
| CONTENT failures | 11 (all MODEL) | 3 (all MODEL) | 3 (all MODEL) |

## The headline finding — PRODUCTION-ready is near-zero for EVERY model

This is **structural, not a model weakness**. The deterministic math verifier
can only rule on a bare closed arithmetic expression (`Tính: 45 + 27 = ?`).
Given `problemStructure: direct_computation` in the ProblemDNA, **no model**
reliably writes those — all three embellish into word problems, which the
verifier cannot check. So 95–100% of content-accepted items land in
`PENDING_CROSSCHECK`.

Consequence for the architecture (a Round‑2+ / design decision, per §ANSWER
VERIFICATION POLICY "do NOT add a large new system before Round 1"):

1. A production pipeline needs an **answer cross-check** (AI second-pass or
   human) for the ~95% of items the deterministic verifier can't rule on; **or**
2. `buildItemGenerationSpecs` deliberately allocates more bare-computation slots
   (mechanical but verifiable) — trading worksheet richness for verifiability;
   **or**
3. the deterministic verifier is extended to parse simple single-step word
   problems (a bounded, real piece of work — not a "large new system").

The honest `PENDING_CROSSCHECK` state is preserved; nothing is claimed as
production-safe that isn't independently verified.

## Every remaining CONTENT failure (17 total, categorised)

| category | count | detail |
|---|---|---|
| **MODEL** — similarity vs sibling | 13 | number-tuple / template / phrasing reuse *within* a worksheet. Legit — the models struggle with variety on 8–16-item single-skill worksheets (HC05, LT-G7-06). gpt-4.1-mini + gpt-5-mini much better than gpt-4o-mini. |
| **MODEL** — reasoning item, no rubric | 3 (all gpt-4o-mini) | model emits `rubric: null` for a `reasoning` item; 1 retry didn't fix it. Partly prompt-clarity — the system prompt should hard-require a non-null rubric when `answer` is empty. |
| **VALIDATOR/spec** (mis-tagged MODEL by the classifier) | 1 (gpt-4o-mini) | `answerKind: numeric` for a geometry "name the angle type" skill → model answered "góc tù". `answerKindFor` needs a geometry-classification branch (`exact`/`choice`, not `numeric`). |

Zero INFRA failures this run (the `max_completion_tokens` / `reasoning_effort`
fix worked — gpt-5-mini went from 0% to fully operational). Zero LEAKAGE
(reference-copy) failures for any model.

## Per-model read

- **gpt-4o-mini** — fastest (2.3s p50), cheapest (13 VND/content item), but the
  weakest: 81% CONTENT after retry, 11 failures, worst similarity + the only
  rubric omissions. First-pass 60% is well below the §5 90% target.
- **gpt-4.1-mini** — 94.8% CONTENT after retry, only 3 failures, 100% uniqueness,
  5s p50, 38 VND/content item. Solid all-round.
- **gpt-5-mini** — best first-pass (84.5%, so fewest retries at 0.16/item) and
  94.8% after retry, only 3 failures. But 10.4s avg latency (4× gpt-4o-mini) and
  60 VND/content item (verbose: 55k output tokens vs ~19–30k).

## §3 gate check

CONTENT acceptance after 1 retry ≥ 80% for **all three** models (81 / 94.8 /
94.8). The §3 "proceed to Round 2 if ≥ 1 model ≥ 80%" condition is satisfied on
CONTENT — but per §10 this is a hard STOP for anh's review.

## Open decisions for anh before Round 2

1. **The verifier-coverage / PENDING_CROSSCHECK question** (above) — this is the
   real blocker for a "production-ready" number and needs a direction (add an AI
   cross-check step / add verifiable slots / extend the verifier).
2. Two small validator fixes to fold in before Round 2: geometry
   `answerKind` mapping; system-prompt hard-require rubric for reasoning items.
3. Round 2 as specified = 26 specs × MODE A × the same 3 minis. Est. spend
   ~$1.0–1.5 (gpt-5-mini dominates on both latency and $).
