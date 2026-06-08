import { writeFileSync } from 'node:fs';

export function output(io, value) {
  io.log(JSON.stringify(value, null, 2));
}

export function outputMaybeFile(io, args, value) {
  const json = JSON.stringify(value, null, 2);
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && args[outIndex + 1]) writeFileSync(args[outIndex + 1], json + '\n');
  else io.log(json);
}
