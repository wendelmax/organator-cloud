import { IsolationError } from './identifiers.js';

const SECRET_PATTERNS = [
  /postgresql:\/\/[^\s]+/gi,
  /postgres:\/\/[^\s]+/gi,
  /password\s*=\s*\S+/gi,
  /token\s*=\s*\S+/gi,
  /secret\s*=\s*\S+/gi,
  /apikey\s*=\s*\S+/gi,
  /authorization:\s*\S+/gi,
  /Bearer\s+\S+/gi,
  /:[^:@]+@/g,
];

export interface SanitizedError {
  code: string;
  message: string;
}

export function sanitizeIsolationError(error: unknown): SanitizedError {
  if (error instanceof IsolationError) {
    return {
      code: error.code,
      message: redactSecrets(error.message),
    };
  }

  return {
    code: 'ISOLATION_UNEXPECTED',
    message: 'Unexpected data isolation failure',
  };
}

function redactSecrets(message: string): string {
  let result = message;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
