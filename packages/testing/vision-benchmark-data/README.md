# Document-vision benchmark dataset (P4 — productionization phase)

This directory is the local, **never-committed** home for real homework/test
photos used to evaluate a real `DocumentVisionAdapter` before ever turning
paid OCR on for a pilot family. The harness itself lives in
[`../src/benchmark/vision-benchmark.ts`](../src/benchmark/vision-benchmark.ts).

> **Status (2026-09-05):** 9 real cases (`case-01`..`case-09`, anh's Grade-4
> homework, "Toán 4 — Hệ thống trường liên cấp Newton – Pascal", 3 weekly
> worksheets) are in `manifest.json` + `expected/*.json` — 46 items total.
> **`expected/*.json` was drafted by Claude reading the photos, NOT reviewed
> by anh** — treat it as a first draft, not verified ground truth, until
> someone double-checks it (some items are deliberately `null`-mapped where
> no confident production skill id exists, e.g. grade-3-review perimeter
> questions this KB doesn't have a skill for). Run
> `node scripts/run-vision-benchmark.mjs` to smoke-test the harness against
> these 9 files with the free `MockDocumentVisionAdapter` — that run scores
> low on every metric by construction (the mock never looks at real pixels)
> and proves the PIPELINE works, not OCR accuracy. No real (paid) vision call
> has been made against these images — that needs an actual
> `DocumentVisionAdapter` implementation plus anh's explicit go-ahead (real
> money, a real API call per image).

## Why this isn't just "add sample images to the repo"

- **Privacy.** Real homework/test pages are a child's handwriting, name, and
  school context — exactly the category `PRIVACY_ARCHITECTURE.md` and the
  30-day raw-upload-retention rule exist to protect. They must never enter
  git history (`images/` below is gitignored).
- **No fabricated results.** A benchmark run with zero real images reports
  `ranCaseCount: 0` and says so explicitly — it is never presented as "0%
  accuracy" or backfilled with invented numbers. Every metric the harness
  produces is scored against a real image + a human-reviewed expected answer,
  or it doesn't run at all.

## Layout

```
vision-benchmark-data/
  images/                 <- gitignored. Real photos go here.
    case-001.jpg
    case-002.jpg
    ...
  expected/                <- COMMITTED. Ground truth, no image bytes.
    case-001.json
    case-002.json
    ...
  manifest.json             <- COMMITTED. The list of cases + their metadata
                                (id, image filename, grade, kindHint,
                                knownSkillIds) — everything the harness needs
                                EXCEPT the pixels and the answer key.
```

`expected/<id>.json` shape (matches `VisionBenchmarkExpected` in
`vision-benchmark.ts`):

```json
{
  "documentType": "HOMEWORK",
  "problemCount": 4,
  "itemTexts": ["Tính 3/4 + 1/2", "..."],
  "itemMathExpressions": ["3/4+1/2", null],
  "itemSkillIds": ["M4.FRAC.ADD", null]
}
```

`itemMathExpressions[i]` / `itemSkillIds[i]` are `null` when that item has no
math notation to extract, or no confident curriculum mapping even for a human
— don't force an answer where there genuinely isn't one; the metrics exclude
`null` ground truth from that item rather than scoring it as wrong.

## Building the 20–30 case set (per the productionization directive)

Aim for real variety, not 30 near-duplicates:
- Both pilot grades (4 and 7).
- Worksheet, graded test, and plain homework (the 3 `kindHint`s that produce
  items).
- At least a few genuinely hard handwriting samples, not just clean copies.
- A couple of pages with NO clear curriculum mapping for some items (tests
  whether the adapter honestly reports low confidence instead of guessing).

For each image: **anh (or whoever reviews the images) fills in `expected/`
by hand** — that's the ground truth a machine cannot supply. This is
necessarily a manual, careful step; rushing it defeats the point of having a
benchmark at all.

## Running it

There is no CLI wired up yet (out of scope for "prepare the harness" — add
one, or a small script under `scripts/`, once a real `DocumentVisionAdapter`
exists to point it at). Until then:

```ts
import { readFile } from 'node:fs/promises';
import { runVisionBenchmark, formatVisionBenchmarkReport } from '@copilot/testing';
// import the real adapter once one exists — @copilot/uploads only has
// MockDocumentVisionAdapter and a non-functional OpenAiVisionAdapter stub today.

const report = await runVisionBenchmark({
  adapter /* real adapter, or MockDocumentVisionAdapter to smoke-test the harness itself */,
  cases /* built from manifest.json + expected/*.json */,
  readImageBytes: (path) => readFile(path).then((b) => new Uint8Array(b)).catch(() => null),
});
console.log(formatVisionBenchmarkReport(report));
```

## Reading the report

Five metrics, always reported **separately** — the productionization
directive is explicit that these must not be blended into one "accuracy"
number:

| Metric | What it means if low |
|---|---|
| text extraction | OCR is misreading words/numbers |
| math extraction | notation (fractions, exponents, operators) is misread even when nearby text is fine |
| problem extraction | the page isn't being segmented into the right number of problems |
| curriculum mapping | skill-id guesses don't match the true topic |
| confidence calibration | stated confidence doesn't track real correctness — this is the DANGEROUS one: high confidence + low accuracy is exactly what silently produces wrong "VERIFIED" evidence |

A low confidence-calibration score is a blocker on its own even if the other
four look fine — per the productionization directive: "Do not silently
convert low-confidence mapping into VERIFIED evidence."
