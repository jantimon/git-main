import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: 'src/git-main.mjs',
  output: {
    file: 'dist/git-main.js',
    format: 'esm',
    banner: '#!/usr/bin/env node',
  },
  plugins: [
    nodeResolve({
      preferBuiltins: true,
      browser: false,
      exportConditions: ['node']
    }),
    commonjs({
        ignore: ['navigator']
      }),
    json(),
  ],
  external: [
    'fs', 'path', 'child_process', 'os', 'util', 'events', 'stream', 
    'readline', 'assert', 'buffer', 'string_decoder', 'tty'
  ]
};