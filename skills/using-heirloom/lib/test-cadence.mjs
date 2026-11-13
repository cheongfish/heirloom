// Opt-in test cadence for the development workflow (project setting `testCadence.mode`).
//
// Development workflows such as Superpowers run the whole test suite after every task, which
// is slow on large plans. In "phase" mode the session start adds the rules below: tasks are
// grouped into phases, a task runs only the tests that cover it, and the full suite runs at
// the end of each phase. The test commands come from the plan; Heirloom does not choose them.
// The rules are the user's choice for this project, so they are stated as a user instruction.

/** Rules added to the session start when the project opted in. */
export const PHASE_CADENCE_RULES = `This project's Heirloom setting \`testCadence.mode\` is \`phase\` in \`.heirloom/config.json\`. The user chose it: treat these rules as the user's instruction about when to run tests. They take precedence over skill defaults that run the full test suite after every task or before every commit.

- **Planning.** When you write an implementation plan, group the tasks into phases by their nature and order: tasks that touch the same module or contract go in the same phase, and a phase should stay small enough that a failure points to few tasks. End each phase with a "phase gate" step that runs the project's full test suite. Write the exact commands in the plan: each task's focused test commands, and the full-suite command at each phase gate.
- **Implementing a task.** Run only the tests that cover the task: the focused commands the plan gives, plus the existing tests of the modules the task changed. Do not run the full test suite for a single task, also not before committing it.
- **Reviewing a task.** Base the test evidence on the implementer's reported runs (command and output). Do not run tests again by default. Run a focused test only when reading the code raises a specific doubt that no reported run answers, and say which doubt it was. Never run the full test suite to review a single task.
- **Phase gate.** A phase gate is not a task: no subagent implements it, and you run it yourself. Run it right after the review of the phase's last task is settled and before you dispatch the first task of the next phase: run the full test suite as the plan states it and record the command and result in your progress notes (for example the execution ledger). Never skip a gate, also not when every task's focused tests passed. If anything fails, fix it inside this phase before starting the next one.
- **Always full at the end.** Run the full test suite at the last phase gate, before the final review, and before a Heirloom handoff.
- **Subagents.** Subagents do not see this block. When you dispatch a subagent to implement or fix a task, copy the "Implementing a task" rule into its brief, and tell it that a phase gate, not the task, runs the full suite. When you dispatch a task reviewer, copy the "Reviewing a task" rule into its brief.
- **Reports.** Say which tests you ran and whether that was a focused run or the full suite, so a reviewer does not take a focused run for a full one.
- When the plan has no phases (it was written before this setting, or by someone else), treat the whole plan as one phase: focused tests per task, the full suite once after the last task.`;

/**
 * The block for the session start, or null when the project did not opt in.
 * @param {{ mode: 'off' | 'phase' }} cadence
 */
export function testCadenceBlock(cadence) {
  return cadence.mode === 'phase' ? `<heirloom-test-cadence>\n${PHASE_CADENCE_RULES}\n</heirloom-test-cadence>` : null;
}
