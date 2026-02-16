const test = require('node:test');
const assert = require('node:assert/strict');

const { calcUpdates, withRetries, parseVersion } = require('../scripts/model-updater');

test('calcUpdates returns only newer versions', () => {
  const local = {
    version: '1.0.0',
    models: {
      a: { version: '1.0.0', file: 'a.onnx' },
      b: { version: '2.0.0', file: 'b.onnx' },
    },
  };

  const remote = {
    version: '1.1.0',
    models: {
      a: { version: '1.1.0', file: 'a.onnx', url: 'https://example.com/a.onnx' },
      b: { version: '2.0.0', file: 'b.onnx', url: 'https://example.com/b.onnx' },
      c: { version: '1.0.0', file: 'c.onnx', url: 'https://example.com/c.onnx' },
    },
  };

  const updates = calcUpdates(local, remote);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].name, 'a');
  assert.equal(updates[1].name, 'c');
});

test('withRetries retries before success', async () => {
  let attempts = 0;
  const value = await withRetries(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('transient');
    }
    return 'ok';
  }, { retries: 3, delayMs: 1 });

  assert.equal(value, 'ok');
  assert.equal(attempts, 3);
});

test('parseVersion normalizes invalid parts', () => {
  assert.deepEqual(parseVersion('2.3.beta'), [2, 3, 0]);
  assert.deepEqual(parseVersion(undefined), [0, 0, 0]);
});
