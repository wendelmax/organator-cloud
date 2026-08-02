import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import axios from 'axios';
import { Client } from 'ssh2';
import { decryptSecret } from './crypto';

export const PROVIDER_TYPES = ['AWS', 'VERCEL', 'VPS'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** Campos de segredo exigidos por tipo (chaves do encryptedData). */
export const SECRET_FIELDS: Record<ProviderType, string[]> = {
  AWS: ['accessKeyId', 'secretAccessKey'],
  VERCEL: ['apiToken'],
  VPS: ['privateKey'],
};

/** Valores mockados aceitos para teste/demo — nunca são enviados a um provider real. */
const MOCK_SECRETS: Record<ProviderType, string[]> = {
  AWS: ['mock-access-key', 'mock-secret-key'],
  VERCEL: ['mock-token'],
  VPS: ['mock-key'],
};

/**
 * Mascara um segredo para leitura/listagem. Nunca expõe mais do que os
 * primeiros caracteres: tokens `sk_...` viram `sk-****`, chaves privadas
 * viram `-----BEGIN [PRIVATE KEY] ****`, demais viram `prefixo-****`.
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value);
  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(trimmed)) {
    return '-----BEGIN [PRIVATE KEY] ****';
  }
  if (trimmed.startsWith('sk_')) {
    return 'sk-****';
  }
  if (trimmed.length > 8) {
    return `${trimmed.slice(0, 4)}-****`;
  }
  return '****';
}

/**
 * Mascara todos os segredos de uma credencial (objeto encryptedData) para
 * resposta de API. Como os valores são cifrados, a máscara é derivada do
 * CAMPO (nunca do conteúdo): apiToken → sk-****, accessKeyId → AKIA-****,
 * privateKey → -----BEGIN [PRIVATE KEY] ****, demais → ****.
 */
export function maskProviderData(
  encryptedData: Record<string, unknown>,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const key of Object.keys(encryptedData ?? {})) {
    masked[key] = maskSecretField(key);
  }
  return masked;
}

function maskSecretField(key: string): string {
  if (/token|apiKey/i.test(key)) {
    return 'sk-****';
  }
  if (/accessKeyId/i.test(key)) {
    return 'AKIA-****';
  }
  if (/privateKey|sshKey|private/i.test(key)) {
    return '-----BEGIN [PRIVATE KEY] ****';
  }
  return '****';
}

export interface TestConnectionResult {
  ok: boolean;
  mock?: boolean;
  message: string;
}

function isMock(type: ProviderType, secrets: Record<string, string>): boolean {
  const mocks = MOCK_SECRETS[type];
  for (const field of SECRET_FIELDS[type]) {
    const value = decryptSecret(secrets[field] || '');
    if (!value) return true;
    if (mocks.includes(value)) return true;
  }
  return false;
}

/**
 * Testa a conexão com o provider usando as credenciais (já decifradas).
 * - Credenciais mock/demo → sucesso simulado (`mock: true`).
 * - Credenciais reais → chamada leve de autenticação (STS/Vercel/SSH).
 * Nunca lança: qualquer falha vira `{ ok: false, message }`.
 */
export async function testProviderConnection(
  type: ProviderType,
  secrets: Record<string, string>,
  config: Record<string, unknown> = {},
  timeoutMs = 5000,
): Promise<TestConnectionResult> {
  try {
    if (isMock(type, secrets)) {
      return {
        ok: true,
        mock: true,
        message: 'Conexão simulada (mock) — credenciais de demonstração.',
      };
    }
    if (type === 'AWS') {
      return await testAws(secrets, timeoutMs);
    }
    if (type === 'VERCEL') {
      return await testVercel(secrets, timeoutMs);
    }
    return await testVps(secrets, config, timeoutMs);
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Falha inesperada na conexão.' };
  }
}

async function testAws(
  secrets: Record<string, string>,
  timeoutMs: number,
): Promise<TestConnectionResult> {
  const accessKeyId = decryptSecret(secrets.accessKeyId || '');
  const secretAccessKey = decryptSecret(secrets.secretAccessKey || '');
  const client = new STSClient({
    region: 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });
  const result = await Promise.race([
    client.send(new GetCallerIdentityCommand({})),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!result) {
    return { ok: false, message: 'Timeout na autenticação AWS (STS).' };
  }
  const arn = (result as any).Arn || (result as any).UserId || 'AWS';
  return { ok: true, message: `AWS autenticado (STS GetCallerIdentity): ${arn}` };
}

async function testVercel(
  secrets: Record<string, string>,
  timeoutMs: number,
): Promise<TestConnectionResult> {
  const apiToken = decryptSecret(secrets.apiToken || '');
  const res = await axios.get('https://api.vercel.com/v2/user', {
    headers: { Authorization: `Bearer ${apiToken}` },
    timeout: timeoutMs,
  });
  const user = res.data?.user;
  const label =
    user?.username || user?.email || user?.id || 'usuario Vercel';
  return { ok: true, message: `Vercel autenticado: ${label}` };
}

async function testVps(
  secrets: Record<string, string>,
  config: Record<string, unknown>,
  timeoutMs: number,
): Promise<TestConnectionResult> {
  const privateKey = decryptSecret(secrets.privateKey || '');
  const host = String(config.host || 'localhost');
  const port = Number(config.port) || 22;
  const username = String(config.username || 'root');

  return new Promise<TestConnectionResult>((resolve) => {
    const conn = new Client();
    let settled = false;
    const settle = (result: TestConnectionResult) => {
      if (settled) return;
      settled = true;
      conn.end();
      resolve(result);
    };

    conn
      .on('ready', () => {
        conn.exec('echo ok', (err, stream) => {
          if (err) {
            return settle({
              ok: false,
              message: `SSH falhou ao executar: ${err.message}`,
            });
          }
          stream
            .on('close', () => {
              settle({
                ok: true,
                message: `SSH conectado em ${host}:${port} (${username}).`,
              });
            })
            .on('data', () => {});
          stream.stderr.on('data', () => {});
        });
      })
      .on('error', (err) => {
        settle({ ok: false, message: `SSH falhou: ${err.message}` });
      })
      .connect({
        host,
        port,
        username,
        privateKey,
        readyTimeout: timeoutMs,
      });

    setTimeout(() => {
      settle({ ok: false, message: `Timeout de conexão SSH (${timeoutMs}ms).` });
    }, timeoutMs + 1000);
  });
}
