export type SongInput = {
  title: string;
  lyrics: string;
  prompt: string;
  tempo: number;
  key: string;
};

export type ArrangementSection = {
  id: string;
  name: string;
  start: number;
  duration: number;
  energy: 'low' | 'medium' | 'high';
  musicians: string[];
};

export type LyricCue = {
  word: string;
  start: number;
  end: number;
  section: string;
};

export type MusicianMix = {
  level: number;
  space: number;
  intensity: number;
  muted: boolean;
  solo: boolean;
};

export const songInstruments = [
  'acoustic-guitar',
  'bass-guitar',
  'electric-guitar',
  'pedal-steel',
  'fiddle',
  'keyboard',
  'vocal',
] as const;

export function emptyMusicianMix(): Record<string, MusicianMix> {
  return Object.fromEntries(songInstruments.map((instrument, index) => [instrument, {
    level: instrument === 'vocal' ? 84 : 62 - (index % 3) * 4,
    space: instrument === 'bass-guitar' ? 25 : 48,
    intensity: instrument === 'vocal' ? 72 : 58,
    muted: false,
    solo: false,
  }]));
}

export function validateSongInput(input: SongInput) {
  if (!input.title.trim()) return 'Give the song a title.';
  if (input.title.length > 50) return 'Song titles are limited to 50 characters.';
  if (!input.lyrics.trim()) return 'Add lyrics so AIM can create the vocal timing.';
  if (input.lyrics.length > 5000) return 'Lyrics are limited to 5,000 characters.';
  if (!input.prompt.trim()) return 'Describe the production direction in the prompt.';
  if (input.prompt.length > 2500) return 'Prompts are limited to 2,500 characters.';
  return null;
}

export function createRadioArrangement(tempo: number): ArrangementSection[] {
  const secondsPerBar = 240 / tempo;
  const blueprint: Array<[string, number, ArrangementSection['energy'], string[]]> = [
    ['Intro', 4, 'low', ['acoustic-guitar', 'keyboard']],
    ['Verse 1', 12, 'medium', ['acoustic-guitar', 'bass-guitar', 'keyboard', 'vocal']],
    ['Pre-chorus', 4, 'medium', ['acoustic-guitar', 'bass-guitar', 'fiddle', 'keyboard', 'vocal']],
    ['Chorus 1', 8, 'high', ['acoustic-guitar', 'bass-guitar', 'electric-guitar', 'pedal-steel', 'fiddle', 'keyboard', 'vocal']],
    ['Verse 2', 12, 'medium', ['acoustic-guitar', 'bass-guitar', 'electric-guitar', 'keyboard', 'vocal']],
    ['Chorus 2', 8, 'high', ['acoustic-guitar', 'bass-guitar', 'electric-guitar', 'pedal-steel', 'fiddle', 'keyboard', 'vocal']],
    ['Bridge', 8, 'medium', ['bass-guitar', 'pedal-steel', 'fiddle', 'keyboard', 'vocal']],
    ['Final chorus', 12, 'high', ['acoustic-guitar', 'bass-guitar', 'electric-guitar', 'pedal-steel', 'fiddle', 'keyboard', 'vocal']],
    ['Outro', 4, 'low', ['acoustic-guitar', 'pedal-steel', 'keyboard']],
  ];
  let start = 0;
  return blueprint.map(([name, bars, energy, musicians], index) => {
    const duration = bars * secondsPerBar;
    const section = { id: `${name.toLowerCase().replace(/\s/g, '-')}-${index}`, name, start, duration, energy, musicians };
    start += duration;
    return section;
  });
}

export function createLyricTimeline(lyrics: string, arrangement: ArrangementSection[]): LyricCue[] {
  const words = lyrics.replace(/\[[^\]]+\]/g, ' ').match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  const vocalSections = arrangement.filter((section) => section.musicians.includes('vocal'));
  if (!words.length || !vocalSections.length) return [];
  const totalDuration = vocalSections.reduce((sum, section) => sum + section.duration, 0);
  const step = totalDuration / words.length;
  let cursor = 0;
  return words.map((word) => {
    let local = cursor;
    const section = vocalSections.find((candidate) => {
      if (local <= candidate.duration) return true;
      local -= candidate.duration;
      return false;
    }) ?? vocalSections[vocalSections.length - 1];
    const start = section.start + Math.min(local, Math.max(0, section.duration - step));
    cursor += step;
    return { word, start, end: start + Math.min(step * 0.88, 1.2), section: section.name };
  });
}

export function toLrc(cues: LyricCue[]) {
  return cues.map((cue) => {
    const minutes = Math.floor(cue.start / 60);
    const seconds = (cue.start % 60).toFixed(2).padStart(5, '0');
    return `[${String(minutes).padStart(2, '0')}:${seconds}]${cue.word}`;
  }).join('\n');
}