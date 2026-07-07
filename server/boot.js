// Cloud entrypoint. Restores the persisted data/ files from the cloud DB
// BEFORE the app loads them, then starts the normal server in this same
// process (so shutdown flush still works). Local runs use `node server/index.js`
// directly and skip all of this.
import { restore } from './persist.js';

await restore();
await import('./index.js');
