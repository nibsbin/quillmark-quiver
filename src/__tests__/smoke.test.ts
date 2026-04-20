import { it } from 'vitest';

it('builds', async () => {
  await import('../index.js');
  await import('../node.js');
});
