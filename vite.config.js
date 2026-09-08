import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // Relative paths, so dist/index.html works opened straight from disk
  // or from a USB stick — not just when served from a domain root.
  base: './',

  plugins: [viteSingleFile()],

  build: {
    // Inline every asset regardless of size. The whole point is one file;
    // a stray 20KB font left as a separate request breaks offline use.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,

    // No modulepreload polyfill. A single-file build has no
    // link[rel=modulepreload] for it to act on, so it is dead code — but it
    // is dead code containing a fetch() call, in a file whose entire claim
    // is that it makes no requests. Anyone auditing this by reading rather
    // than by running it should not have to work out that the one fetch
    // never fires.
    modulePreload: false,
    cssCodeSplit: false,
    // Readable output. This game is ~2000 lines, not a 3MB app, and being
    // able to read dist/index.html when something breaks in the field is
    // worth more than the bytes saved.
    minify: 'esbuild',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    // Fail loudly rather than silently emitting a multi-file build.
    reportCompressedSize: true,
  },

  server: {
    open: true,
  },
});
