# Pilot decisions

## PD-1 — Teacher-initiated connection (§17)

**Decision: OUT of pilot scope. The pilot connection flow is invite-code only.**

- Parent → `Kết nối` → **Tạo mã kết nối** (optionally pick a subject) → shares
  the code out-of-band → Teacher → `Kết nối` → **Nhập mã** → the parent sees a
  pending request → approves and scopes permissions.
- This is fully implemented on web and mobile, covered by golden journeys J3/J4
  and the M3 integration tests.
- The reverse direction (teacher enters a parent's email to request a
  connection) has an API method (`createRelationshipRequest`) but **no UI**. It
  is not exposed anywhere. There is no half-supported path in the product.
- Revisit post-pilot if teachers ask for it; it needs an `emailExists`-gated
  request form + a parent inbox entry, both of which the backend already
  supports.

## PD-2 — Font (§18)

**Decision: bundle Be Vietnam Pro (native), do not block on it.**

- `@expo-google-fonts/be-vietnam-pro` (SIL Open Font License) is bundled in
  `apps/mobile` and loaded in `app/_layout.tsx` via `useFonts`; the splash
  screen is held until it resolves.
- Until it loads (or if loading fails) the OS system font is used — the app is
  fully usable either way.
- Web already ships Be Vietnam Pro.

## PD-3 — Subscription (§19)

**Decision: entitlements real, billing MOCK, clearly labelled.**

- `EntitlementService` gates features/quotas for real (FREE / BASIC 169K /
  PLUS 229K / PRO 329K).
- `setPlan` performs **no charge** — it returns `billing: "MOCK_NO_CHARGE"`.
  There is **no purchase flow, no card entry, no payment gateway** anywhere.
- The plan screen (`/goi-dich-vu` web, Settings on mobile) states in Vietnamese:
  *"Bản thử nghiệm: đổi gói không phát sinh thanh toán"* and *"Gói không ảnh
  hưởng tới chất lượng hay mô hình AI"*.
- Entitlement logic stays fully testable (3 pure tests + the M7 integration
  test); wiring a real gateway later touches only `setPlan`.

## PD-4 — AI / OCR (§20)

**Decision: pilot runs entirely on deterministic / mock paths.**

- Exercise generation: legacy reference-library path (no LIVE AI). `AI_GENERATION_MODE=OFF`.
- Document vision: `MockDocumentVisionAdapter` (deterministic, offline) unless an
  operator sets `DZ_LIVE_VISION=1` **and** `OPENAI_API_KEY` — not set for pilot.
- No paid OCR. No upload or practice action can spend provider budget.
- Pilot readiness does **not** depend on any paid provider.
