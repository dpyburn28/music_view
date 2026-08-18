const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../audio-input.js');

test('defaults per viz role', () => {
  assert.equal(A.defaultAudioInput('audio-scope').source, 'full');
  assert.equal(A.defaultAudioInput('audio-history').source, 'envelope');
  assert.equal(A.defaultAudioInput('audio-beat').source, 'beat');
  assert.equal(A.defaultAudioInput('audio-beat').envelope, 'envelope');
  assert.equal(A.defaultAudioInput('artef4kt').high, 'treble');
  assert.equal(A.defaultAudioInput('song-cover'), null);
});

test('sanitize fills missing keys and rejects unknown roles', () => {
  const beat = A.sanitizeAudioInput({ source: 'kick', gain: 1.5 }, 'audio-beat');
  assert.equal(beat.source, 'kick');
  assert.equal(beat.envelope, 'envelope');
  assert.equal(beat.bass, 'bass');
  assert.equal(beat.gain, 1.5);
  assert.equal(A.sanitizeAudioInput({ source: 'full' }, 'song-info'), null);
});

test('sanitize drops unknown channels', () => {
  const scope = A.sanitizeAudioInput({ source: 'stems-vocals', gain: 99 }, 'audio-scope');
  assert.equal(scope.source, 'full');
  assert.equal(scope.gain, 4);
});

test('continuous audio defaults on and can be disabled', () => {
  assert.equal(A.defaultAudioInput('audio-history').continuous, true);
  assert.equal(A.sanitizeAudioInput({}, 'audio-scope').continuous, true);
  assert.equal(A.sanitizeAudioInput({ continuous: false }, 'audio-beat').continuous, false);
  assert.equal(A.sanitizeAudioInput({ continuous: 'false' }, 'artef4kt').continuous, false);
});
