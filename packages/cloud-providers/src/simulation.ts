/**
 * Modo simulado dos provedores (Vercel, AWS, VPS): sem credenciais reais, as
 * chamadas devolvem valores fictícios para demonstrar o fluxo localmente.
 *
 * `PROVIDER_SIMULATION=true|false` decide explicitamente; sem ela, só é ligado
 * fora de produção. Em produção uma falha do provedor nunca vira sucesso.
 */
export function providerSimulationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.PROVIDER_SIMULATION?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.NODE_ENV !== 'production';
}

/** Em simulação devolve `fallback()`; caso contrário propaga a falha original. */
export function simulateOrThrow<T>(provider: string, action: string, err: unknown, fallback: () => T): T {
  const message = err instanceof Error ? err.message : String(err);
  if (!providerSimulationEnabled()) {
    throw new Error(`[${provider}] ${action} failed: ${message}`);
  }
  console.warn(`[${provider}] ${action} failed (${message}); PROVIDER_SIMULATION is on, returning a simulated result.`);
  return fallback();
}
