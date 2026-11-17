---
name: using-heirloom
description: "Heirloom session conventions for context recall, handoffs, and human approval. Injected at session start."
---

# Using Heirloom

Heirloom hands off finished work for dashboard approval and preserves approved decisions for later tasks. A handoff reports readiness; it proves neither correctness nor approval.

## When to request a handoff

Before you tell the user that the implementation and final review of a **spec-based task** are finished, invoke the `prepare-handoff` skill. Pass the spec you worked from and say which source state the final review covered.

Do not request a handoff for intermediate progress, while awaiting a user answer, after interruption or error, or again for the same state (`prepare-handoff` detects duplicates).

Without a spec, hand off only on the user's request. If the stop hook reminds you once per session, mention the option in one sentence when reporting completion.

`prepare-handoff` freezes the user's typed messages as possible decision sources. Your suggestion is not a decision unless the user's message states it.

Never guess the target branch, task identifier or spec; leave unknown values unknown.

## Project context

The session-start `<heirloom-project>` block gives two rules, the paths that decision records cover, and this worktree's open handoffs. It never gives record titles or text.

- Follow the two rules for the whole session.
- Before editing a file under a listed path, use `recall-context` with the intended paths and read the full records. Its result says which records are active, pending for this task, or other tasks' unmerged changes (not rules; report conflicts).
- Do not discover rules by reading `.heirloom/decisions/` or `.heirloom/axioms/` directly: working-tree files may be superseded or unmerged.

## Approval boundary

Only humans approve, through the dashboard.

- Never create or edit `~/.heirloom/tasks/*/approvals/` or hand-edit `.heirloom/decisions/` and `.heirloom/axioms/`.
- Only `apply-approval` writes records from verified signed approval. Do not claim approval before verification.
- Report approved but unapplied handoffs listed at session start; apply when the user asks.
- A handoff listed as returned (되돌림) was sent back in the dashboard with reasons. Report it; when the user asks, fix the code and hand off again with `prepare-handoff`.
- When this session's approval wait (`prepare-handoff` step 5) reports `approved`, run `apply-approval` immediately without asking again.

## Dashboard

To show pending approvals or reopen a handoff:

```sh
node <this skill>/scripts/open-dashboard.mjs [--task <taskId>]
```

Omitting `--task` opens the overview. If `opened` is false, give the printed `url` to the user. Never call the dashboard HTTP API directly.

## Scripts and commits

Read session-start commit guide files and follow them for every commit.

Use only the scripts named by skills. Never call library modules directly (including via `node -e`) or create/edit `~/.heirloom/` files. Report missing inputs instead of working around them.

Each script prints one JSON object: `{"ok": true, "data": ...}` or `{"ok": false, "error": {"code", "message", "retryable", "hint"}}`.

Exit 75 (`E_TRANSIENT`) means a retry already occurred. Do not rerun; report the error and hint.
