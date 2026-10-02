import Stripe from 'stripe';

const DEV_STRIPE_KEYS = ['sk_test_123', 'sk_test_placeholder', ''];

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

/**
 * Cancela imediatamente as assinaturas ainda cobráveis do customer (offboarding:
 * o cliente não pode continuar sendo cobrado por um tenant removido).
 * Retorna os ids cancelados; sem Stripe configurado não faz nada.
 */
export async function cancelCustomerSubscriptions(
  customerId: string | null | undefined,
): Promise<string[]> {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!customerId || DEV_STRIPE_KEYS.includes(key)) return [];

  const canceled: string[] = [];
  for await (const subscription of stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  })) {
    if (['canceled', 'incomplete_expired'].includes(subscription.status)) {
      continue;
    }
    await stripe.subscriptions.cancel(subscription.id);
    canceled.push(subscription.id);
  }
  return canceled;
}
