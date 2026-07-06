# Grouped Boss Picker E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser smoke coverage for the categorized, collapsed boss picker and fix only the small UX sync issues that coverage exposes.

**Architecture:** Keep the feature inside the existing Vite frontend. The e2e smoke suite mocks `/api/bosses` and `/api/leaderboard/*`, then exercises the real React UI through Playwright. If implementation is needed, keep it local to the picker components and grouping helpers.

**Tech Stack:** React, TypeScript, Vite, Vitest, Playwright.

---

### Task 1: Grouped Boss Browser Smoke

**Files:**
- Modify: `frontend/e2e/smoke.spec.ts`
- Potentially modify: `frontend/src/components/RaidVariantPicker.tsx`

- [x] **Step 1: Write the failing test**

Add an e2e test that mocks grouped boss keys, opens the combobox, selects the collapsed Chambers of Xeric row, verifies the variant picker renders mode/type/size controls, changes to Challenge Mode, and sees the leaderboard URL update to the selected variant.

- [x] **Step 2: Run the targeted e2e test to verify red**

Run: `cd frontend && npm run test:e2e -- --grep "grouped boss"`

Expected: fail if the current picker does not initialize/sync selected mode and kind from the current boss URL.

- [x] **Step 3: Implement the minimum fix**

If the test fails because `RaidVariantPicker` stays on the first mode/type while `selected` points elsewhere, derive the active mode and kind from `selected` and keep local state synced when `selected`, `base`, or `bosses` changes.

- [x] **Step 4: Run targeted e2e green**

Run: `cd frontend && npm run test:e2e -- --grep "grouped boss"`

Expected: the grouped boss smoke test passes.

- [x] **Step 5: Run full frontend verification**

Run:
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd frontend && npm run test:e2e`

Expected: unit tests, production build, and e2e smoke all pass.

- [x] **Step 6: Commit and push**

Commit message: `Add grouped boss picker smoke coverage`

Push to: `fork frontend-rebuild-vite`
