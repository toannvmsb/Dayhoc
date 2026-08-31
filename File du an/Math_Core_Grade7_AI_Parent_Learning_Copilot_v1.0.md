# AI Parent Learning Copilot — Math Core Grade 7 v1.0

## Status
LOCKED MVP foundation for Grade 7 pilot.

## Core rule
`school_grade = 7` is context, not a ceiling. Runtime decisions are skill-based and prerequisite-based.

## Source layers
1. SGK Toán 7 Kết nối tri thức Tập 1–2 — standard curriculum backbone.
2. Recent real homework/review sheet (13/8) — fractions/rational arithmetic, equations, percentage, ray/midpoint and combinatorial counting.
3. Recent BTVN 15/8 — ratio/proportion, equal-ratio chains, multi-variable systems, product/quadratic constraints.
4. “Biến đổi đồng nhất” — advanced algebra, symmetric expressions, factorization, identities, proof, nonlinear systems; includes HSG Grade 9 material.

## Standard curriculum domains
- Rational numbers and operations
- Real numbers
- Angles and parallel lines
- Congruent triangles
- Data collection/representation
- Ratios, proportions, proportional quantities
- Algebraic expressions and one-variable polynomials
- Probability
- Triangle relationships
- Practical solids/geometry

## Runtime taxonomy
```yaml
knowledge_level:
  K0: prerequisite_gap
  K1: concept_intro
  K2: grade7_standard
  K3: strong_grade7
  K4: above_grade_or_HSG
  K5: competition_nonroutine

thinking_level:
  T1: execute
  T2: recognize_apply
  T3: transform_combine
  T4: strategic_reasoning
  T5: nonroutine_proof_or_structure
```

## Cross-grade skill families

### G7.RAT — Rational arithmetic
- fraction/rational operations
- fast calculation by structure
- powers and zero exponent
- sign rules
- nested rational expressions

Prerequisites: integer arithmetic, fractions, order of operations.

### G7.EQ — Equation reasoning
Problem ladder:
1. one-step rational equation
2. multi-step linear equation
3. distributive equation
4. rational expression equation
5. structure producing square/quadratic relation
6. equation embedded in ratio/system condition

Gap diagnosis must distinguish arithmetic/sign/distributive/recognition/algebraic-structure gaps.

### G7.RATIO — Ratio and proportion
```text
direct proportion
→ equal ratio
→ chain of equal ratios
→ ratio + linear condition
→ ratio + product condition
→ ratio + quadratic condition
→ transformed denominators
→ multi-variable nonlinear reasoning
```

Recent 15/8 material is a golden source for this family.

### G7.MULTIVAR — x,y,z systems
- x/a = y/b = z/c
- multiple chained ratios
- ratio + linear equation
- ratio + xyz constraint
- ratio + quadratic form
- shifted-variable ratio
- rational denominator systems

### G7.ALG.IDENTITY — Algebraic identities / transformation
Cross-grade frontier:
```text
distributive property
→ polynomial expansion
→ common-factor extraction
→ algebraic identities
→ symmetric expressions
→ factorization
→ conditional simplification
→ proof
→ nonlinear systems / HSG
```

### G7.SYM — Symmetric algebra
- use a+b, ab to derive a²+b², (a-b)², a³+b³, higher powers
- x + 1/x recurrence-like transformations
- conditions in ab+bc+ca
- cyclic/symmetric rational expressions
- a+b+c=0 identities

### G7.FACTOR — Factorization
- common factor
- grouping
- identities
- cyclic/symmetric structures
- factorization under conditions

### G7.PROOF — Algebraic proof
- identity proof
- derive invariant from condition
- inequality/sign reasoning
- integer/perfect-power reasoning
- HSG-style transformation

### G7.GEO — Geometry
- angles/parallel lines
- congruent triangles
- midpoint/ray/segment
- triangle relationships
- practical solids

### G7.COMB — Combinatorial thinking
The 13/8 geometry-context problem about many points and number of segments must map to combinatorial counting, not only geometry.
Core idea: choose 2 endpoints / systematic counting.

## Actual Learning Frontier
Store frontier by domain:
```yaml
frontier:
  rational_arithmetic: G7_strong
  ratio_systems: G7_advanced
  algebraic_transformation: G8_G9_HSG_exposure
  symmetric_algebra: G9_HSG_exposure
  geometry: G7_context
  combinatorial_thinking: advanced
```
This is exposure/readiness-specific, not a claim of whole-grade mastery.

## Problem-type mastery
Track separately from skill mastery:
```yaml
problem_type_mastery:
  direct_ratio: 0-100
  chained_ratio: 0-100
  ratio_linear_constraint: 0-100
  ratio_product_constraint: 0-100
  ratio_quadratic_constraint: 0-100
  identity_recognition: 0-100
  symmetric_transformation: 0-100
  factorization: 0-100
  proof_strategy: 0-100
```

## Root-gap rule
Never infer “weak algebra” from failure on an HSG problem.
Trace:
1. arithmetic
2. sign/order
3. distributive
4. fraction/rational manipulation
5. ratio/proportion
6. factorization/identity
7. structural recognition
8. proof strategy

## Parallel Gap Repair
If child is currently taught an above-grade skill but a prerequisite is weak:
- do not automatically stop advanced learning;
- compute readiness;
- keep advanced path if safe;
- allocate parallel gap-repair dose.

## Golden cases
### G7-01 — 13/8 mixed review
Expected: map rational arithmetic, equation levels, percentage word problem, geometry and combinatorial counting separately.

### G7-02 — 15/8 ratio chain
Expected: identify progression from direct proportion to multi-variable constraints.

### G7-03 — Ratio + xyz
Expected: map ratio substitution + product constraint; do not label as simple proportion.

### G7-04 — Ratio + quadratic condition
Expected: K4/T4+ classification; check algebraic readiness.

### G7-05 — Identity from a+b and ab
Expected: symmetric expression transformation; trace identities.

### G7-06 — x + 1/x higher powers
Expected: recognize recurrence/identity structure; avoid brute-force generation.

### G7-07 — Factorization
Expected: classify common factor/grouping/identity/symmetric structure.

### G7-08 — HSG Grade 9 source
Expected: school_grade remains 7; curriculum_origin can be G9_HSG; readiness and prerequisite graph govern recommendation.

### G7-09 — Failure caused by prerequisite
Expected: diagnose root prerequisite and issue Learning Prescription.

### G7-10 — Failure caused by thinking
Expected: knowledge mastery remains strong; lower problem-type/thinking state instead of over-penalizing core knowledge.

## Non-negotiable runtime rules
1. Never generate by grade alone.
2. Never equate exposure to Grade 9 material with Grade 9 global mastery.
3. Keep `curriculum_origin`, `knowledge_level`, `thinking_level`, `readiness`, and `mastery` separate.
4. Preserve evidence history.
5. Above-grade recommendations require prerequisite/readiness checks.
6. Gap repair can run in parallel with advanced learning.
7. HSG/competition problems need explicit problem-type and thinking tags.
