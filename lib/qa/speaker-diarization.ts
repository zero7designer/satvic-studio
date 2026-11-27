export type DiarizedSpeechSegment = {
  speakerId: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type SpeakerDiarization = {
  speakerCount: number;
  speakers: { id: string; firstSeenSeconds: number; turnCount: number }[];
  segments: DiarizedSpeechSegment[];
  note: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSpeakerId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Gemini returned a speech segment without a speaker label.');
  const normalized = value.trim().toLocaleLowerCase().replace(/^speaker\s+/, 'speaker_').replace(/[\s-]+/g, '_');
  if (!/^[a-z0-9_]{1,40}$/.test(normalized)) throw new Error('Gemini returned an invalid speaker label.');
  return normalized;
}

export function parseSpeakerDiarization(value: unknown): SpeakerDiarization {
  if (!isRecord(value) || !Array.isArray(value.segments) || value.segments.length > 1000) {
    throw new Error('Gemini returned an invalid speaker-segment list.');
  }

  const segments = value.segments.map((rawSegment): DiarizedSpeechSegment => {
    if (!isRecord(rawSegment)) throw new Error('Gemini returned an invalid speech segment.');
    const speakerId = normalizeSpeakerId(rawSegment.speakerId);
    const startSeconds = Number(rawSegment.startSeconds);
    const endSeconds = Number(rawSegment.endSeconds);
    const text = typeof rawSegment.text === 'string' ? rawSegment.text.trim() : '';
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || !text) {
      throw new Error('Gemini returned invalid speaker timestamps or speech text.');
    }
    return { speakerId, startSeconds, endSeconds, text };
  }).sort((left, right) => left.startSeconds - right.startSeconds);

  const speakerMap = new Map<string, { id: string; firstSeenSeconds: number; turnCount: number }>();
  for (const segment of segments) {
    const existing = speakerMap.get(segment.speakerId);
    if (existing) {
      existing.firstSeenSeconds = Math.min(existing.firstSeenSeconds, segment.startSeconds);
      existing.turnCount += 1;
    } else {
      speakerMap.set(segment.speakerId, {
        id: segment.speakerId,
        firstSeenSeconds: segment.startSeconds,
        turnCount: 1,
      });
    }
  }

  const speakers = [...speakerMap.values()].sort((left, right) => left.firstSeenSeconds - right.firstSeenSeconds);
  return {
    speakerCount: speakers.length,
    speakers,
    segments,
    note: typeof value.note === 'string' ? value.note.trim().slice(0, 500) : '',
  };
}

export function parseDeepgramDiarization(value: unknown): SpeakerDiarization {
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.metadata.diarize_info)) {
    throw new Error('Deepgram did not return confirmation that its diarizer ran.');
  }
  if (!isRecord(value.results) || !Array.isArray(value.results.utterances)) {
    throw new Error('Deepgram returned no diarized speech turns.');
  }

  const segments: Record<string, unknown>[] = [];
  for (const utterance of value.results.utterances) {
    if (!isRecord(utterance)) throw new Error('Deepgram returned an invalid speech turn.');
    if (Array.isArray(utterance.words) && utterance.words.length > 0) {
      const wordSegments: { speakerId: string; startSeconds: unknown; endSeconds: unknown; text: string }[] = [];
      for (const word of utterance.words) {
        if (!isRecord(word) || (typeof word.speaker !== 'number' && typeof word.speaker !== 'string')) {
          throw new Error('Deepgram returned a word without a speaker label.');
        }
        if ((typeof word.speaker === 'number' && (!Number.isSafeInteger(word.speaker) || word.speaker < 0))
          || (typeof word.speaker === 'string' && !word.speaker.trim())) {
          throw new Error('Deepgram returned an invalid speaker label.');
        }
        const speakerId = `speaker_${word.speaker}`;
        const text = typeof word.punctuated_word === 'string' && word.punctuated_word.trim()
          ? word.punctuated_word.trim()
          : typeof word.word === 'string' ? word.word.trim() : '';
        if (!text) throw new Error('Deepgram returned a word without text.');
        const previous = wordSegments[wordSegments.length - 1];
        if (previous?.speakerId === speakerId) {
          previous.endSeconds = word.end;
          previous.text = `${previous.text} ${text}`;
        } else {
          wordSegments.push({ speakerId, startSeconds: word.start, endSeconds: word.end, text });
        }
      }
      segments.push(...wordSegments);
      continue;
    }

    if ((typeof utterance.speaker !== 'number' && typeof utterance.speaker !== 'string')
      || (typeof utterance.speaker === 'number' && (!Number.isSafeInteger(utterance.speaker) || utterance.speaker < 0))
      || (typeof utterance.speaker === 'string' && !utterance.speaker.trim())) {
      throw new Error('Deepgram returned a speech turn without a valid speaker label.');
    }
    segments.push({
      speakerId: `speaker_${utterance.speaker}`,
      startSeconds: utterance.start,
      endSeconds: utterance.end,
      text: utterance.transcript,
    });
  }

  const parsed = parseSpeakerDiarization({ segments, note: '' });
  const arch = value.metadata.diarize_info.arch;
  return {
    ...parsed,
    note: typeof arch === 'string' ? `Deepgram diarizer ${arch}.` : 'Deepgram speaker diarization completed.',
  };
}
