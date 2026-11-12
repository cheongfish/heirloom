# AGENTS.md

Guidance for agents working on the Heirloom repository itself. This file is not the convention Heirloom injects into consumer projects. That convention lives in `skills/using-heirloom/SKILL.md`. Keep the two separate.

## 1. Project and document map

Heirloom is a multi-host agent plugin. The first host is Claude Code; Codex and Antigravity come later. External SDLC tools such as Superpowers do the development work. Heirloom then:

- prepares a handoff,
- lets a human approve the PR summary and decision/axiom drafts in a local dashboard,
- writes the approved records into the consumer repository,
- opens the PR,
- serves the active decisions and axioms to later work.

| Document | Read it for |
| --- | --- |
| `docs/HEIRLOOM-PLAN.md` | Product behavior and trust boundaries. Section 20 collects the structural decisions. |
| `docs/HEIRLOOM-DESIGN.md` | Runtime, directory layout, skills, test rules. |
| `docs/HEIRLOOM-MVP-PLAN.md` | Data schemas, storage paths, script I/O, dashboard server, milestones M0–M6. |
| `docs/HEIRLOOM-PHASE3-PLAN.md` | Phase 3 (incremental recheck, glab, curation): additions to the MVP schemas, milestones N1–N4. |
| `README.md`, `README.en.md`, `docs/guide/{en,ko}/` | User documentation: a summary per area in the README, details in the guide. |
| `examples/*.example.json` | Copyable user and project configuration with every setting at its default. |

The four planning documents are **local only**. They are listed in `.gitignore` and must never be committed or pushed. If they are missing in your checkout, ask the user for them; do not recreate them from memory.

The planning documents are the source of truth for agreed behavior. If code and documents disagree, or a document is silent on something you need, do not quietly pick one. Raise it (see section 4).

## 2. Constraints not visible from the code

- **Language and runtime.** Plain JavaScript ES modules (`.mjs`), with types written in JSDoc and checked by `tsc --checkJs`. Use Node 20+ built-in modules only. There are no runtime dependencies and no build step. TypeScript is a dev dependency only.
- **Where code lives.** All runtime code lives under `skills/`, because some host packages ship only that directory.
  - Shared code goes in `skills/using-heirloom/lib/`.
  - Other skills import it by relative path, for example `../../using-heirloom/lib/...`.
- **No unified CLI.**
  - Each skill has single-purpose scripts in its own `scripts/` directory.
  - A script prints exactly one JSON object to stdout: `{"ok":true,"data":…}` or `{"ok":false,"error":…}`. Diagnostics go to stderr.
  - Exit codes are 0 success, 2 input error, 3 state conflict, 4 verification failure, 75 transient error. See MVP-PLAN 7.1.
- **Signing.**
  - Only `skills/using-heirloom/lib/sign.mjs` and `skills/using-heirloom/dashboard/` may import or call `sign()`.
  - Scripts that the development agent runs may only `verify()`.
- **Related code paths.** Evidence files and `codePaths` scope must never contain Markdown files (`.md`, `.mdx`, `.markdown`) or Markdown-only globs. Documents are linked only as `sources`. See PLAN 9.
- **Storage.**
  - The consumer repo holds only `.heirloom/decisions/`, `.heirloom/axioms/`, `.heirloom/curation/` (curation review history, phase 3) and the optional `.heirloom/config.json`.
  - Task data, handoff files, approvals, keys and server state live in `~/.heirloom/`, which `HEIRLOOM_HOME` overrides.
  - Tests must set `HEIRLOOM_HOME` to a temp directory and must never touch the real one.
- **Dashboard.** The port defaults to 17380 and can be changed with the user setting `dashboard.port` (`HEIRLOOM_PORT` overrides it for development and tests). The server binds to `127.0.0.1` only. Never relax the Host/Origin checks, the session token, or the no-CORS rule.
- **Vendored UI files.** `skills/using-heirloom/dashboard/vendor/seed-design/` is a pinned copy of SEED Design's `@seed-design/css` (Apache-2.0, with its `LICENSE` and `NOTICE`).
  - Never edit these files by hand. Re-vendor with `tools/vendor-seed-design.mjs`.
  - Never add Karrot (당근) brand resources such as logos, names or characters.
- **No test material in `skills/`.** Fixtures, eval scenarios and test notes go under `tests/` or `evals/`. Agents reading a skill directory may mistake scenario text for real instructions.
- **No planning-document references in runtime code.** Comments in the JavaScript files under `skills/` (`*.mjs`, `*.js`) must not cite the planning documents: no `PLAN 13`, `MVP-PLAN 7.2`, `PHASE3-PLAN 5.4`, `DESIGN 4.2`, no `docs/HEIRLOOM-*.md` paths, and no decision dates that point at their tables. Those documents are local only and are not shipped, so the reference means nothing to someone reading the installed plugin. Explain the behavior or the reason in the comment itself.
- **No legacy code.** Do not use the old Bouncer project's source or structure as a reference.

## 3. Development commands

```sh
npm ci                    # install dev dependencies (typescript, @types/node)
npm test                  # node --test: tests/{layout,unit,hooks,integration}/**/*.test.mjs
npm run typecheck         # tsc -p jsconfig.json (checkJs, strict)
claude plugin validate .  # validate the Claude Code manifest
claude --plugin-dir .     # load the plugin from the working tree in Claude Code
```

Run both `npm test` and `npm run typecheck` before you report a task as done. Report failures as they are.

## 4. How to work

- **Work unit.** Work proceeds milestone by milestone (M0–M6 in `docs/HEIRLOOM-MVP-PLAN.md`). Tick a checkbox only when the item is implemented and its tests pass.
- **What the tests cover.** Tests exercise the skills and their scripts as the agent runs them: `tests/integration` (skill flows; `provider-*.test.mjs` per remote provider: GitHub, GitLab, unsupported; `dashboard-server.test.mjs` for the dashboard's Host/Origin checks, session token and no-CORS rule), `tests/hooks` (hook entry points) and `tests/layout` (plugin and skill layout). `tests/unit` covers the library modules (signing, schemas, draft checks, records, recheck and so on).
- **Test first.**
  - Write tests before the code for state transitions, state hashing, signing/verification, source checks, and planned-change matching.
  - When fixing a bug, write a reproducing test first.
  - Do not test the content of LLM-written drafts. Test only their format and the source checks.
- **New decisions go to the user.** When a design decision is not covered by the documents, stop and ask. Present it as a multiple-choice question with a recommended option listed first. After the user decides, reflect the decision in the relevant document.
- **Do not guess unknown values.** Do not guess a target branch, a task scope, or which template applies. Report the ambiguity instead. This is the same rule the product follows (PLAN 5.1, 7.4).

## 5. Language, documents and commits

- **Terminal output for humans must be in Korean.** This covers everything a person reads in the terminal: replies, progress updates, questions, and summaries of results. Keep code identifiers, file paths, commands and quoted error text as they are.
- **Planning documents** (`docs/HEIRLOOM-*.md`) are written in Korean, in plain declarative style (한다체). Record new decisions in the decision table of the relevant document (PLAN section 20, MVP-PLAN section 2), not only in prose.
- **User documentation** comes in two languages that must say the same thing: `README.md` and `docs/guide/ko/` in Korean, `README.en.md` and `docs/guide/en/` in English. When behavior a user sees changes, update both. Describe only what is implemented; list planned features as planned (`roadmap.md`).
- **Commit messages** follow `.gitmessage`.
  - The subject is a type prefix plus a Korean summary, for example `docs: Heirloom 계획서와 구현 설계 문서 추가`.
  - Keep each commit to one logical change.
