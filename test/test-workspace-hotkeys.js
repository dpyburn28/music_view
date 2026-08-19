const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTyping, spaceTarget } = require('../src/workspace/workspace-hotkeys');

test('isTyping covers form fields and contenteditable', () => {
  assert.equal(isTyping({ tagName: 'INPUT' }), true);
  assert.equal(isTyping({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTyping({ tagName: 'SELECT' }), true);
  assert.equal(isTyping({ tagName: 'BUTTON' }), false);
  assert.equal(isTyping({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTyping(null), false);
});

test('spaceTarget never routes to both clocks', () => {
  assert.equal(spaceTarget({ focus: 'music' }), 'track');
  assert.equal(spaceTarget({ focus: 'stage' }), 'track');
  assert.equal(spaceTarget({ focus: 'look' }), 'track');
  assert.equal(spaceTarget({ focus: 'performance' }), 'show');
  assert.equal(spaceTarget({ focus: 'music', showDriving: true }), 'show');
  assert.equal(spaceTarget({ focus: 'stage', present: true, inShow: true }), 'show');
  assert.equal(spaceTarget({ focus: 'music', present: true, inShow: true }), 'track');
});
