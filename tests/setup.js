import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { resetDB } from '../src/db.js';

afterEach(async () => {
  await resetDB();
});
