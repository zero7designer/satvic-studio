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
