import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlanPrice, planHighlights } from './plans';

// Espaços do Intl (NBSP) normalizados para comparar.
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('formatPlanPrice', () => {
  test('formats cents in the plan currency and cycle', () => {
    assert.equal(plain(formatPlanPrice({ price: 4900, currency: 'usd', cycle: 'monthly' })), 'US$ 49,00/mês');
    assert.equal(plain(formatPlanPrice({ price: 199000, currency: 'brl', cycle: 'yearly' })), 'R$ 1.990,00/ano');
  });
});

describe('planHighlights', () => {
  test('describes the quotas the checkout will enforce', () => {
    assert.deepEqual(planHighlights({ MICROSERVICE: 20, DEPLOYMENT: 100, SEATS: 1, APIS: 50 }), [
      '20 microsserviços',
      '100 deploys/mês',
      '1 membro',
    ]);
  });

  test('handles unlimited and missing quotas', () => {
    assert.deepEqual(planHighlights({ MICROSERVICE: -1, DOMAINS: -1 }), [
      'microsserviços ilimitados',
      'domínios ilimitados',
    ]);
    assert.deepEqual(planHighlights(null), []);
  });
});
