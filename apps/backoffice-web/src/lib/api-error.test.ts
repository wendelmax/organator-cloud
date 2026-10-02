import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorMessage } from './api-error';

const json = (body: unknown, status = 400) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('apiErrorMessage', () => {
  test('uses the API message, e.g. the plan limit (402)', async () => {
    assert.equal(
      await apiErrorMessage(json({ code: 'QUOTA_EXCEEDED', message: 'Limite do plano atingido.' }, 402), 'x'),
      'Limite do plano atingido.',
    );
  });

  test('joins validation messages', async () => {
    assert.equal(
      await apiErrorMessage(json({ message: ['image must be a docker image reference', 'vpsHost must be user@host'] }), 'x'),
      'image must be a docker image reference. vpsHost must be user@host',
    );
  });

  test('falls back without a usable body', async () => {
    assert.equal(await apiErrorMessage(new Response('oops', { status: 500 }), 'Falhou'), 'Falhou');
    assert.equal(await apiErrorMessage(json({ message: '' }), 'Falhou'), 'Falhou');
  });
});
