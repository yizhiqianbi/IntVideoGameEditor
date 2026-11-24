import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ absWorkingDir: fileURLToPath(new URL('.', import.meta.url)), entryPoints: ['rtc-entry.js'], bundle: true, format: 'iife', platform: 'browser', outfile: '.data/rtc.js', minify: true });
