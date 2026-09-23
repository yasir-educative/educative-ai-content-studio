# Publish Rules — Non-Negotiable

## Core rule

**Nothing is ever published to Educative automatically.**

Publishing is always a deliberate user action triggered by clicking a Publish button in the UI. No pipeline, background job, or route may trigger a publish as a side effect, convenience step, or fallback.

---

## Course pipeline (`publish-all/route.ts`)

The course publish route does **four steps only**:

1. Create lesson page (`createLesson`)
2. Patch widget blocks from stored stage outputs
3. Resolve images (`resolveImageBlocksForLesson`)
4. Save lesson content (`saveLesson`)
5. Add lesson to chapter in CHP (`addPageToChapter`)

**The Educative publish endpoint is never called.** `publishCourse()` does not exist in this route and must never be re-added. The collection is updated (CHP PUT) but not published/made-live.

---

## Mobile course pipeline (`/api/mobile-course/[id]/publish`)

Cards reach Educative only when the user explicitly clicks **Publish** in the mobile course UI. The generation pipeline (SSE stream) saves cards to local storage only — it never touches the Educative API.

---

## Why

There are established team review workflows. Auto-publishing bypasses those workflows, puts live content on the platform before it has been reviewed, and creates incidents. This rule exists because of real pressure those incidents caused.

---

## For any new feature

If you are adding a new pipeline or route that writes content:

- Default behaviour: **save to local storage / draft state only**
- Publish to Educative: **only when the user explicitly triggers it**
- If you are unsure whether a step publishes: check with the team before shipping
