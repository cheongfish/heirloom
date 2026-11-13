// Host adapters: each host's hook input, hook output and transcript lines, mapped to and from
// the host-neutral shapes the hook logic uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOSTS, hostAdapter, transcriptCalls, transcriptUtterances } from '../../skills/using-heirloom/lib/hosts/index.mjs';

test('hostAdapter: known hosts, claude-code by default, unknown names rejected', () => {
  assert.deepEqual([...HOSTS].sort(), ['antigravity', 'claude-code', 'codex']);
  assert.equal(hostAdapter(undefined).name, 'claude-code');
  assert.equal(hostAdapter('').name, 'claude-code');
  assert.equal(hostAdapter('codex').name, 'codex');
  assert.equal(hostAdapter('antigravity').name, 'antigravity');
  assert.throws(() => hostAdapter('vim'), /vim/);
});

test('readHookInput: cwd, transcript path and the continuation flag; wrong types are dropped', () => {
  for (const name of ['claude-code', 'codex']) {
    const host = hostAdapter(name);
    assert.deepEqual(host.readHookInput({ cwd: '/w', transcript_path: '/t.jsonl', stop_hook_active: true, hook_event_name: 'Stop' }), {
      cwd: '/w',
      workspaces: [],
      transcriptPath: '/t.jsonl',
      continuation: true,
      normalStop: true,
    });
    assert.deepEqual(host.readHookInput({ cwd: 3, transcript_path: null, stop_hook_active: 'yes' }), {
      cwd: undefined,
      workspaces: [],
      transcriptPath: undefined,
      continuation: false,
      normalStop: true,
    });
  }
});

test('readHookInput (Antigravity): camelCase fields, the first workspace path without cwd, and which stops are normal', () => {
  const host = hostAdapter('antigravity');
  const common = { conversationId: 'c', workspacePaths: ['/w', '/x'], transcriptPath: '/b/transcript.jsonl', modelName: 'auto', hookEventName: 'Stop' };
  assert.deepEqual(host.readHookInput({ ...common, cwd: '/w/sub', continuationActive: true, terminationReason: 'NO_TOOL_CALL', fullyIdle: true }), {
    cwd: '/w/sub',
    workspaces: ['/w', '/x'],
    transcriptPath: '/b/transcript.jsonl',
    continuation: true,
    normalStop: true,
  });
  assert.equal(host.readHookInput(common).cwd, '/w');
  assert.equal(host.readHookInput({ continuation_active: true }).continuation, true, 'the name in the 1.5.6 release notes');
  assert.equal(host.readHookInput(common).normalStop, true, 'SessionStart has no termination reason');
  for (const stop of [
    { terminationReason: 'USER_CANCELED' },
    { terminationReason: 'ERROR', error: 'boom' },
    { terminationReason: 'MAX_INVOCATIONS' },
    { terminationReason: 'NO_TOOL_CALL', error: 'boom' },
    { terminationReason: 'NO_TOOL_CALL', fullyIdle: false },
  ]) {
    assert.equal(host.readHookInput({ ...common, ...stop }).normalStop, false, JSON.stringify(stop));
  }
});

test('outputs: SessionStart additionalContext and Stop block (Claude Code and Codex share the format)', () => {
  for (const name of ['claude-code', 'codex']) {
    const host = hostAdapter(name);
    assert.deepEqual(host.sessionStartOutput('규약'), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '규약' } });
    assert.deepEqual(host.stopOutput('상기'), { decision: 'block', reason: '상기' });
    assert.equal(host.emptyOutput, null, 'print nothing');
  }
});

test('outputs (Antigravity): injected system message, continue with a reason, and {} when there is nothing to say', () => {
  const host = hostAdapter('antigravity');
  assert.deepEqual(host.sessionStartOutput('규약'), { injectSteps: [{ systemMessage: { systemMessage: '규약' } }] });
  assert.deepEqual(host.stopOutput('상기'), { decision: 'continue', reason: '상기' });
  assert.deepEqual(host.emptyOutput, {}, 'command hooks must print a JSON object');
});

test('transcriptCalls: Claude Code Read calls give the file path; other tools are ignored', () => {
  const read = { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'Read', input: { file_path: '/r/a.md' } }, { type: 'tool_use', name: 'Bash', input: { command: 'cat /r/b.md' } }] } };
  assert.deepEqual(transcriptCalls(read), [{ read: '/r/a.md' }]);
  assert.deepEqual(transcriptCalls({ type: 'user', message: { content: 'cat /r/a.md' } }), []);
});

test('transcriptCalls: Codex shell calls give their command text; messages and other tools are ignored', () => {
  const exec = { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'const r = await tools.exec_command({cmd:"cat a.md",workdir:"/r"});' } };
  assert.deepEqual(transcriptCalls(exec), [{ text: exec.payload.input }]);

  const call = { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"sed -n 1,9p a.md","workdir":"/r"}' } };
  assert.deepEqual(transcriptCalls(call), [{ text: call.payload.arguments }]);

  const shell = { type: 'response_item', payload: { type: 'local_shell_call', action: { type: 'exec', command: ['cat', 'a.md'], working_directory: '/r' } } };
  assert.deepEqual(transcriptCalls(shell), [{ text: 'cat a.md workdir:"/r"' }]);

  for (const other of [
    { type: 'response_item', payload: { type: 'function_call', name: 'send_message_to_user_async', arguments: '{"message":"a.md"}' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'cat a.md' }] } },
    { type: 'event_msg', payload: { type: 'task_started' } },
    null,
    'text',
  ]) {
    assert.deepEqual(transcriptCalls(other), []);
  }
});

test('transcriptCalls: Antigravity read_file gives the path and run_command its command line; other steps are ignored', () => {
  const read = { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'read_file', args: { Path: '/r/a.md' } }, { name: 'view_file', args: { AbsolutePath: '/r/b.md' } }] };
  assert.deepEqual(transcriptCalls(read), [{ read: '/r/a.md' }, { read: '/r/b.md' }]);
  const run = { step_index: 2, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: { CommandLine: 'cat a.md', Cwd: '/r', toolSummary: 'x' } }] };
  assert.deepEqual(transcriptCalls(run), [{ text: 'cat a.md workdir:"/r"' }]);
  for (const other of [
    { step_index: 9, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'write_file', args: { Path: '/r/a.md' } }] },
    { step_index: 0, type: 'USER_INPUT', content: 'cat a.md' },
    { step_index: 11, type: 'PLANNER_RESPONSE', content: '/r/a.md' },
  ]) {
    assert.deepEqual(transcriptCalls(other), []);
  }
});

// Line shapes below are taken from real transcripts: Claude Code 2.x, Codex 0.167.0 rollouts and
// `agy` 1.5.7 transcript_full.jsonl.

test('transcriptUtterances (Claude Code): typed messages only, not tool results, meta lines or harness text', () => {
  const user = (/** @type {any} */ content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
  assert.deepEqual(transcriptUtterances(user('테스트 위치는 tests/unit로 하자')), ['테스트 위치는 tests/unit로 하자'], 'older versions have no origin');
  assert.deepEqual(transcriptUtterances(user('반올림하지 말자', { origin: { kind: 'human' }, isSidechain: false })), ['반올림하지 말자']);
  assert.deepEqual(transcriptUtterances(user([{ type: 'text', text: '이미지와 함께' }, { type: 'image', source: {} }])), ['이미지와 함께']);
  for (const skipped of [
    user([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }]),
    user([{ type: 'text', text: 'Base directory for this skill: /x' }], { isMeta: true }),
    user('요약', { isCompactSummary: true }),
    user('subagent prompt', { isSidechain: true }),
    user('<task-notification>\n<task-id>b1</task-id>', { origin: { kind: 'task-notification' } }),
    user('<command-name>/clear</command-name>'),
    user('<local-command-caveat>The command below was run directly</local-command-caveat>'),
    user('<bash-input>ls</bash-input>'),
    user('<system-reminder>x</system-reminder>'),
    user([{ type: 'text', text: '[Request interrupted by user]' }]),
    user('   '),
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '에이전트의 답' }] } },
  ]) {
    assert.deepEqual(transcriptUtterances(skipped), [], JSON.stringify(skipped));
  }
});

test('transcriptUtterances (Codex): the UserMessage item, not response_item lines that also carry harness text', () => {
  const item = (/** @type {any} */ i) => ({ timestamp: 't', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'u', item: i } });
  assert.deepEqual(transcriptUtterances(item({ type: 'UserMessage', id: '1', content: [{ type: 'text', text: '반올림하지 말자', text_elements: [] }] })), ['반올림하지 말자']);
  assert.deepEqual(transcriptUtterances(item({ type: 'HookPrompt', id: '2', fragments: [{ text: 'Heirloom 인계 확인' }] })), []);
  assert.deepEqual(transcriptUtterances(item({ type: 'AgentMessage', id: '3', content: [{ type: 'text', text: '답' }] })), []);
  const responseItem = (/** @type {string} */ text, /** @type {any} */ provenance) => ({
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }], internal_chat_message_metadata_passthrough: { content_item_metadata: [{ provenance }] } },
  });
  assert.deepEqual(transcriptUtterances(responseItem('<environment_context>', { type: 'harness', hook: false })), []);
  assert.deepEqual(transcriptUtterances(responseItem('반올림하지 말자', { type: 'user' })), [], 'the same message comes from the item event');
});

test('transcriptUtterances (Antigravity): the text inside USER_REQUEST of a USER_EXPLICIT step; slash commands are not messages', () => {
  const step = (/** @type {string} */ content, extra = {}) => ({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', content, ...extra });
  const first = '<USER_REQUEST>\n테스트는 tests/unit에 둔다.\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-13T11:19:29+09:00.\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection`.\n</USER_SETTINGS_CHANGE>';
  assert.deepEqual(transcriptUtterances(step(first)), ['테스트는 tests/unit에 둔다.']);
  assert.deepEqual(transcriptUtterances(step('<USER_REQUEST>\n/compact\n</USER_REQUEST>')), []);
  assert.deepEqual(transcriptUtterances(step('<USER_REQUEST>\nx\n</USER_REQUEST>', { source: 'SYSTEM' })), []);
  assert.deepEqual(transcriptUtterances({ step_index: 1, type: 'SYSTEM_MESSAGE', source: 'SYSTEM_SDK', content: 'The following is a <SYSTEM_MESSAGE>' }), []);
  assert.deepEqual(transcriptUtterances({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', content: '<USER_REQUEST>x</USER_REQUEST>' }), []);
});
