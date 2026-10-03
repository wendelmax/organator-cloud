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
  /** Login via VoidAuth (OIDC) disponível — mesmas condições do provider em lib/auth.ts. */
  ssoEnabled: boolean;
  /** Documentos legais do operador (TERMS_URL / PRIVACY_POLICY_URL); vazio = sem link. */
  termsUrl: string;
  privacyUrl: string;
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
    ssoEnabled: Boolean(env.VOIDAUTH_CLIENT_ID && env.VOIDAUTH_CLIENT_SECRET),
    termsUrl: env.TERMS_URL?.trim() || "",
    privacyUrl: env.PRIVACY_POLICY_URL?.trim() || "",
  };
}

/** URL da API para chamadas feitas pelo navegador (e no SSR de client components). */
export function publicApiUrl(): string {
  if (typeof window !== "undefined" && window.__ORGANATOR_ENV__?.apiUrl) {
    return normalizeApiUrl(window.__ORGANATOR_ENV__.apiUrl);
  }
  return readPublicEnv().apiUrl;
}

/** O botão de SSO só aparece quando o provider VoidAuth está configurado. */
export function publicSsoEnabled(): boolean {
  if (typeof window !== "undefined" && window.__ORGANATOR_ENV__) {
    return window.__ORGANATOR_ENV__.ssoEnabled === true;
  }
  return readPublicEnv().ssoEnabled;
}

/** Links dos termos de uso e da política de privacidade configurados pelo operador. */
export function publicLegalUrls(): { termsUrl: string; privacyUrl: string } {
  const source =
    typeof window !== "undefined" && window.__ORGANATOR_ENV__
      ? window.__ORGANATOR_ENV__
      : readPublicEnv();
  return { termsUrl: source.termsUrl || "", privacyUrl: source.privacyUrl || "" };
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
