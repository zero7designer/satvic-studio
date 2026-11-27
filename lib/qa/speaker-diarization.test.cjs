const assert = require('node:assert/strict');
const test = require('node:test');
const { parseDeepgramDiarization, parseSpeakerDiarization } = require('./speaker-diarization.ts');

test('derives distinct speaker count from timestamped turns and keeps repeat labels together', () => {
  const result = parseSpeakerDiarization({
    segments: [
      { speakerId: 'Speaker 2', startSeconds: 8, endSeconds: 10, text: 'Second voice.' },
      { speakerId: 'speaker 1', startSeconds: 1, endSeconds: 3, text: 'First voice.' },
      { speakerId: 'SPEAKER_1', startSeconds: 5, endSeconds: 6, text: 'Same first voice.' },
    ],
    note: 'Two distinct voice patterns.',
  });

  assert.equal(result.speakerCount, 2);
  assert.deepEqual(result.speakers, [
    { id: 'speaker_1', firstSeenSeconds: 1, turnCount: 2 },
    { id: 'speaker_2', firstSeenSeconds: 8, turnCount: 1 },
  ]);
  assert.deepEqual(result.segments.map(segment => segment.startSeconds), [1, 5, 8]);
});

test('allows an empty diarization only when Gemini returns no speech segments', () => {
  const result = parseSpeakerDiarization({ segments: [], note: 'No speech detected.' });
  assert.equal(result.speakerCount, 0);
  assert.deepEqual(result.speakers, []);
});

test('rejects segments without usable speaker labels, timestamps, or speech text', () => {
  assert.throws(() => parseSpeakerDiarization({
    segments: [{ speakerId: '', startSeconds: 0, endSeconds: 1, text: 'Speech.' }],
  }), /invalid speaker label/i);
  assert.throws(() => parseSpeakerDiarization({
    segments: [{ speakerId: 'speaker_1', startSeconds: 2, endSeconds: 1, text: 'Speech.' }],
  }), /invalid speaker timestamps/i);
  assert.throws(() => parseSpeakerDiarization({
    segments: [{ speakerId: 'speaker_1', startSeconds: 0, endSeconds: 1, text: '  ' }],
  }), /invalid speaker timestamps/i);
});

test('parses Deepgram utterance labels and counts distinct diarized speakers', () => {
  const result = parseDeepgramDiarization({
    metadata: { diarize_info: { arch: 'v2' } },
    results: {
      utterances: [
        { speaker: 0, start: 0.2, end: 1.1, transcript: 'First voice.' },
        { speaker: 1, start: 1.4, end: 2.2, transcript: 'Second voice.' },
        { speaker: 0, start: 2.6, end: 3.3, transcript: 'First voice again.' },
      ],
    },
  });

  assert.equal(result.speakerCount, 2);
  assert.deepEqual(result.speakers.map(speaker => speaker.turnCount), [2, 1]);
  assert.equal(result.note, 'Deepgram diarizer v2.');
});

test('does not interpret missing Deepgram diarizer metadata as one speaker', () => {
  assert.throws(() => parseDeepgramDiarization({
    metadata: {},
    results: { utterances: [{ speaker: 0, start: 0, end: 1, transcript: 'One voice.' }] },
  }), /did not return confirmation/i);
});
