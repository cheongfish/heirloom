---
trigger: always_on
---

# Heirloom handoff

Before you tell the user that the implementation and final review of a **spec-based task** are finished, invoke the `prepare-handoff` skill. Pass the spec you worked from and say which source state the final review covered.

Do not request a handoff for intermediate progress reports, while you wait for the user, after the user interrupted you or an error stopped you, or again for the same state. Work without a spec is handed off only when the user asks.

The `using-heirloom` skill has the full convention: unknown values, project context and the approval boundary.
