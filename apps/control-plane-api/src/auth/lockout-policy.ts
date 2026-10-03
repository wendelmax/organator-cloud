/** Bloqueio global por tentativas de login (padrão quando o tenant não define). */
export function loginLockoutPolicy(env: NodeJS.ProcessEnv = process.env) {
  const positive = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    maxAttempts: positive(env.LOGIN_MAX_FAILED_ATTEMPTS, 5),
    lockoutMinutes: positive(env.LOGIN_LOCKOUT_MINUTES, 15),
  };
}
