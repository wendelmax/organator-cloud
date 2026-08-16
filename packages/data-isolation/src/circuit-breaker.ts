export type CircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export function evaluateCircuitState(failureCount: number, currentState: CircuitState): { state: CircuitState; nextAttemptAt?: Date } {
  if (failureCount >= 5 && currentState !== 'OPEN') {
    return { state: 'OPEN', nextAttemptAt: new Date(Date.now() + 30000) };
  }
  return { state: currentState };
}
