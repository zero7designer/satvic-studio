import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';
import ffmpegPath from 'ffmpeg-static';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Json = Record<string, any>;

const speakerSchema = {
  type: 'object',
  properties: {
    speakerCount: { type: 'integer' },
    speakers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          firstSeenSeconds: { type: 'number' },
        },
        required: ['id', 'firstSeenSeconds'],
      },
    },
    note: { type: 'string' },
  },
  required: ['speakerCount', 'speakers', 'note'],
};

function outputText(payload: Json): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  return payload.steps?.flatMap((step: Json) => step.content || [])
    .filter((item: Json) => item.type === 'text')
    .map((item: Json) => item.text || '')
    .join('') || '';
}

function providerError(payload: Json): string {
  return payload?.error?.message || payload?.message || payload?.detail || 'Gemini returned no error details.';
}

async function extractAudioFromBlob(stream: ReadableStream<Uint8Array>, extension: string) {
  const executable = ffmpegPath;
  if (!executable) throw new Error('The bundled FFmpeg executable is unavailable.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'satvic-speaker-count-'));
  const inputPath = path.join(directory, `source${extension}`);
  const audioPath = path.join(directory, 'source-audio.mp3');
  try {
    await pipeline(
      Readable.fromWeb(stream as import('node:stream/web').ReadableStream<Uint8Array>),
      createWriteStream(inputPath),
    );
    let diagnostic = '';
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [
        '-nostdin', '-y', '-i', inputPath, '-map', '0:a:0', '-vn',
        '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'mp3', audioPath,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr?.on('data', chunk => { diagnostic = `${diagnostic}${chunk}`.slice(-2000); });
      child.once('error', reject);
      child.once('close', code => code === 0
        ? resolve()
        : reject(new Error(/matches no streams/i.test(diagnostic)
          ? 'No audio track was found in the source video.'
          : `Could not prepare source audio for speaker detection. ${diagnostic.trim().split('\n').slice(-2).join(' ')}`)));
    });
    const audio = await readFile(audioPath);
    if (!audio.length) throw new Error('Audio extraction created an empty file.');
    return audio.toString('base64');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function detectSpeakers(audio: string) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY is missing for speaker detection.');
  const models = [...new Set([
    process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
    process.env.GEMINI_FALLBACK_MODEL?.trim() || 'gemini-3.5-flash-lite',
  ])];
  const body = {
    input: [
      {
        type: 'text',
        text: 'Listen to this original audio and diarize the distinct human speakers. Count each distinct speaker once, even if they speak many times or change emotion. Include a clearly distinct off-screen narrator; exclude music, sound effects, and non-speech. Do not infer the number of visible characters. Return speaker IDs in order of first appearance and each speaker’s first-seen time in seconds. If the audio is unclear, give your best estimate and explain the uncertainty in note. If no speech is audible, return speakerCount 0, an empty speakers array, and explain that no speakers could be identified.',
      },
      { type: 'audio', data: audio, mime_type: 'audio/mp3' },
    ],
    response_format: { type: 'text', mime_type: 'application/json', schema: speakerSchema },
    generation_config: { max_output_tokens: 1024 },
  };
  let lastError = '';
  for (const model of models) {
    try {
      const requestBody = JSON.stringify({ ...body, model });
      if (Buffer.byteLength(requestBody) > 18 * 1024 * 1024) throw new Error('The audio is too large for Gemini speaker detection. Use a shorter source clip.');
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        cache: 'no-store',
        body: requestBody,
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await response.json().catch(() => ({})) as Json;
      if (!response.ok) {
        lastError = `Gemini speaker detection failed (${response.status}): ${providerError(payload)}`;
        if ([403, 404, 429, 500, 502, 503, 504].includes(response.status)) continue;
        throw new Error(lastError);
      }
      const text = outputText(payload).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const result = JSON.parse(text) as Json;
      if (!Number.isSafeInteger(result.speakerCount) || result.speakerCount < 0 || !Array.isArray(result.speakers) || result.speakers.length !== result.speakerCount) {
        throw new Error('Gemini returned an inconsistent speaker count. Try again or enter the count manually.');
      }
      const speakers = result.speakers.map((speaker: Json) => ({
        id: typeof speaker.id === 'string' ? speaker.id.trim() : '',
        firstSeenSeconds: Number(speaker.firstSeenSeconds),
      }));
      if (speakers.some((speaker: { id: string; firstSeenSeconds: number }) => !speaker.id || !Number.isFinite(speaker.firstSeenSeconds) || speaker.firstSeenSeconds < 0)
        || new Set(speakers.map((speaker: { id: string }) => speaker.id)).size !== result.speakerCount) {
        throw new Error('Gemini returned invalid speaker labels. Try again or enter the count manually.');
      }
      return {
        speakerCount: result.speakerCount as number,
        speakers,
        note: typeof result.note === 'string' ? result.note.slice(0, 500) : '',
        model,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Gemini speaker detection failed.';
      if (/inconsistent speaker count|too large for Gemini speaker detection/.test(lastError)) throw error;
    }
  }
  throw new Error(lastError || 'Gemini speaker detection failed on the primary and fallback models.');
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in before detecting speakers.' }, { status: 401 });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'Private video storage is not configured.' }, { status: 503 });

    const body = await request.json() as Json;
    const blobUrl = typeof body.originalBlobUrl === 'string' ? body.originalBlobUrl : '';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(blobUrl);
    } catch {
      return NextResponse.json({ error: 'Upload the source video before detecting speakers.' }, { status: 400 });
    }
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.blob.vercel-storage.com')) {
      return NextResponse.json({ error: 'Invalid source video URL.' }, { status: 400 });
    }
    const expectedPrefix = `satvic-users/${user.id}/satvic-jobs/`;
    const requestedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    if (!requestedPath.startsWith(expectedPrefix)) return NextResponse.json({ error: 'That source video does not belong to your account.' }, { status: 403 });

    const blob = await get(blobUrl, { access: 'private' });
    if (!blob || blob.statusCode !== 200 || !blob.stream || !blob.blob.pathname.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: 'The uploaded source video is no longer available in your account.' }, { status: 404 });
    }
    const extension = path.extname(blob.blob.pathname).toLowerCase();
    const supportedExtension = /^\.(mp4|mov|mkv|avi|webm|m4v|mp3|wav|m4a)$/.test(extension) ? extension : '.mp4';
    const audio = await extractAudioFromBlob(blob.stream, supportedExtension);
    const result = await detectSpeakers(audio);
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not detect speakers from the source audio.';
    console.error(`[api/jobs/speakers] ${message}`);
    return NextResponse.json({ error: message }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
