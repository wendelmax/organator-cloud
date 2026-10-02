/**
 * Mensagem de erro legível de uma resposta da API: `message` do Nest (string ou,
 * na validação, lista de mensagens). Cai para `fallback` sem corpo JSON.
 */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  const message = body?.message;
  if (Array.isArray(message) && message.length) return message.join(". ");
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
}
