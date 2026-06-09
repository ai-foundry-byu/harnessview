// `pnpm scan [path]` — dump the scanned graph as JSON. Debug aid; the real
// entry point is the server.
import { scanHarness } from './index.js';

const root = process.argv[2] || process.cwd();
scanHarness(root)
  .then((g) => {
    process.stdout.write(JSON.stringify(g, null, 2) + '\n');
  })
  .catch((err) => {
    console.error('scan failed:', err);
    process.exit(1);
  });
