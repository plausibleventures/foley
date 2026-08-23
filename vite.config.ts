import { defineConfig } from 'vite';

/**
 * One static page at the root of a subdomain. There is no server and no asset pipeline for
 * audio, because there is no audio to pipe: every sound on this site is a handful of numbers
 * turned into oscillators in the tab, and the WAV you download is rendered here too.
 */
export default defineConfig({
  base: '/',
  build: { target: 'es2022' },
});
