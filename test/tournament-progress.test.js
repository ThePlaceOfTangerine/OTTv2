const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tournamentProgress } = require('../web/tournament-progress');
const tournament = { status: 'locked', entrants: [{}, {}], stages: [{ status: 'locked' }] };
test('progress prioritizes unsaved roster, scheduled opening and pending intake', () => {
  assert.equal(tournamentProgress({}).target, 'tournament-name');
  assert.equal(tournamentProgress({ tournament: { ...tournament, status: 'draft' }, dirtyRoster: true }).target, 'tournament-roster-save');
  assert.equal(tournamentProgress({ tournament: { ...tournament, status: 'draft', entrants: [] } }).target, 'tournament-team-search');
  assert.equal(tournamentProgress({ tournament: { ...tournament, status: 'submissions_open', stages: [{ status: 'open', serverNow: 1, opensAt: 2 }] } }).target, 'tournament-stage-info');
  assert.equal(tournamentProgress({ tournament: { ...tournament, status: 'closing', stages: [{ status: 'closing' }] } }).target, 'tournament-lock');
});
test('progress does not suggest advancing while games are running or paused', () => {
  assert.equal(tournamentProgress({ tournament }).target, 'tournament-refresh');
  for (const [status, rounds, target] of [
    ['not_started', [], 'swiss-start'], ['paused', [], 'swiss-resume'],
    ['running', [{ status: 'running' }], 'swiss-status'],
    ['running', [{ status: 'finished' }], 'swiss-next'],
    ['finished', [], 'qualification-count']
  ]) assert.equal(tournamentProgress({ tournament, swiss: { status, rounds } }).target, target);
});
test('changed rules and an opened resubmission window block start guidance until locked', () => {
  const context = { tournament, swiss: { status: 'finished', qualification: {} }, bracket: { status: 'planned' }, finalRule: { requiresResubmission: true } };
  assert.equal(tournamentProgress(context).target, 'final-intake-announcement');
  for (const status of ['open', 'closing']) assert.equal(tournamentProgress({ ...context, intake: { stage: { status } } }).target, 'final-intake-status');
  assert.equal(tournamentProgress({ ...context, intake: { stage: { status: 'locked' } } }).target, 'bracket-start');
  assert.equal(tournamentProgress({ ...context, finalRule: null, intake: { stage: { status: 'open' } } }).target, 'final-intake-status');
});
test('cancelled and published states override normal advancement; finished bracket awaits approval', () => {
  const context = { tournament, swiss: { status: 'finished', qualification: {} } };
  for (const component of ['tournament', 'swiss', 'bracket']) {
    const state = { ...context, [component]: { ...context[component], status: 'cancelled' } };
    assert.equal(tournamentProgress(state).target, 'tournament-events');
  }
  assert.equal(tournamentProgress(context).target, 'bracket-create');
  assert.equal(tournamentProgress({ ...context, bracket: { status: 'paused' } }).target, 'bracket-resume');
  assert.equal(tournamentProgress({ ...context, bracket: { status: 'finished' } }).target, 'bracket-publish');
  assert.equal(tournamentProgress({ ...context, bracket: { status: 'finished', publishedAt: 123 } }).target, 'tournament-bracket');
});
