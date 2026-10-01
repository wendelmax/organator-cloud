/**
 * Configuração pública lida em RUNTIME (não no build), para que a mesma imagem
 * do painel funcione em qualquer ambiente.
 *
 * - Servidor: lê process.env.PUBLIC_API_URL a cada request.
 * - Navegador: lê window.__ORGANATOR_ENV__, injetado pelo layout raiz.
 *
 * NEXT_PUBLIC_API_URL continua aceita como fallback (compatibilidade), mas é
 * fixada no build pelo Next.js.
 */
export interface PublicEnv {
  apiUrl: string;
}

declare global {
  interface Window {
    __ORGANATOR_ENV__?: Partial<PublicEnv>;
  }
}

const DEFAULT_API_URL = "http://localhost:3001";

/** Base da API sem barra final nem sufixo /v1 (os chamadores acrescentam /v1/...). */
export function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Valores públicos resolvidos no servidor para enviar ao navegador. */
export function readPublicEnv(env: NodeJS.ProcessEnv = process.env): PublicEnv {
  return {
    apiUrl: normalizeApiUrl(env.PUBLIC_API_URL || env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL),
  };
}

/** URL da API para chamadas feitas pelo navegador (e no SSR de client components). */
export function publicApiUrl(): string {
  if (typeof window !== "undefined" && window.__ORGANATOR_ENV__?.apiUrl) {
    return normalizeApiUrl(window.__ORGANATOR_ENV__.apiUrl);
  }
  return readPublicEnv().apiUrl;
}

/** URL da API para código server-side (prefere o endereço interno API_URL). */
export function serverApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.API_URL ? normalizeApiUrl(env.API_URL) : readPublicEnv(env).apiUrl;
}

/** Script inline que expõe a configuração pública ao navegador. */
export function publicEnvScript(env: PublicEnv): string {
  // Escapa "<" para que o JSON não feche a tag <script>.
  return `window.__ORGANATOR_ENV__=${JSON.stringify(env).replace(/</g, "\\u003c")};`;
}
