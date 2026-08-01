import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowPasswordChange';

/**
 * Permite acesso a uma rota autenticada mesmo com mustChangePassword ativo.
 * Usar apenas em rotas de troca de senha/self-service de segurança.
 */
export const AllowPasswordChange = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
