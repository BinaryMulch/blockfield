export const AUDIO_SETTINGS_KEY = 'blockfield-audio';
export const DEFAULT_AUDIO_SETTINGS = Object.freeze({ enabled: true, effects: .8, musicEnabled: true, music: .35 });
export function readAudioSettings(storage) {
  let saved;
  try { saved = JSON.parse(storage?.getItem(AUDIO_SETTINGS_KEY)); } catch { /* Use defaults when storage is unavailable. */ }
  const volume = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  return { enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
    effects: volume(saved?.effects, DEFAULT_AUDIO_SETTINGS.effects),
    musicEnabled: typeof saved?.musicEnabled === 'boolean' ? saved.musicEnabled : true,
    music: volume(saved?.music, DEFAULT_AUDIO_SETTINGS.music) };
}
export function writeAudioSettings(storage, sounds) {
  try { storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ enabled: sounds.enabled, effects: sounds.effectsVolume, musicEnabled: sounds.musicEnabled, music: sounds.musicVolume })); }
  catch { /* Audio controls still work without browser storage. */ }
}
