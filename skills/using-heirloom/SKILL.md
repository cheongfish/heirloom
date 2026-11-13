---
name: using-heirloom
description: "Heirloom handoff convention. Injected at session start; explains when to request a handoff, how to recall active decisions and axioms, and where human approval is required."
---

# Using Heirloom

Heirloom wraps up work that another development workflow (for example Superpowers) has finished. It turns the finished work into a handoff, a human approves the PR summary and decisions in a local dashboard, and the approved decisions are kept for later tasks.

## When to request a handoff

Before you tell the user that the implementation and final review of a **spec-based task** are finished, invoke the `prepare-handoff` skill. Pass the spec you worked from and say which source state the final review covered.

Do not request a handoff:

- for intermediate progress reports,
- while you are waiting for the user to answer or decide something,
- after the user interrupted you, or when you stopped because of an error,
- again for the same state. `prepare-handoff` reports when a handoff already exists for it.

Work that has no spec (a small fix, a refactor, work asked for in the chat) is handed off only when the user asks for it. The stop hook may tell you once per session that this work can be handed off; then tell the user in one sentence when you report the work as finished, and hand off only if they ask.

Decisions the user makes in the conversation can be recorded too. `prepare-handoff` freezes the messages the user typed in this session, and a draft may quote them as a source. Never record your own suggestion as a decision unless the user's message states it.

A handoff means "the agent reports the work is ready to hand off". It is not proof that the work is correct, and it is not an approval.

## Unknown values

Do not guess the target branch, the task identifier or the spec. Pass what you know and leave the rest unknown. Heirloom records unknown values instead of inventing them.

## Project context

The `<heirloom-project>` block at session start lists the active axioms and an index of active decisions. Decisions related to the files you are changing are listed first.

- A record is active once it is merged into the target branch. The block says which branch it was checked against and when the repository was last fetched.
- `[머지 대기]` marks a record this task approved that is not merged yet. It applies to this task only.
- Changes listed under other tasks' pending changes are not rules yet. Do not follow them; tell the user if one conflicts with your work.

The index is a pointer, not the record. Once you know which files you will change, use the `recall-context` skill to read the full text of the related records before you rely on them.

## Approval boundary

Only a human approves, and only in the Heirloom dashboard.

- Never create or edit files under `~/.heirloom/tasks/*/approvals/`.
- Never edit `.heirloom/decisions/` or `.heirloom/axioms/` by hand. The `apply-approval` skill writes them from a verified approval.
- Never tell the user that something is approved unless `apply-approval` verified a signed approval.
- When the session start lists an approved but unapplied handoff, tell the user. Run `apply-approval` when the user asks you to.
- The one exception: when the approval wait you started in this session (`prepare-handoff` step 4) reports `approved`, run `apply-approval` right away.

## Dashboard

When the user wants to see pending approvals or reopen a handoff screen, run:

```sh
node <this skill>/scripts/open-dashboard.mjs [--task <taskId>]
```

Without `--task` it opens the overview of all handoffs. It prints the `url`; if `opened` is false, give the URL to the user. Never call the dashboard's HTTP API yourself.

## Commit messages

When the session start lists commit message guide files, read them and follow them for every commit.

## Heirloom scripts

Heirloom scripts print exactly one JSON object.

- `{"ok": true, "data": ...}` means success.
- `{"ok": false, "error": {"code", "message", "retryable", "hint"}}` means failure.

Exit code 75 (`E_TRANSIENT`) means the script already retried once. Do not run it again. Report the failure and the hint to the user.
