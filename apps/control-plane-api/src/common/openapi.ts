import { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import {
  ApiBearerAuth,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export const API_DOCS_PATH = 'docs';
const BEARER = 'bearer';

/** Docs ligadas fora de produção; em produção só com API_DOCS_ENABLED=true. */
export function apiDocsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.API_DOCS_ENABLED !== undefined) {
    return env.API_DOCS_ENABLED === 'true';
  }
  return env.NODE_ENV !== 'production';
}

function usesJwtGuard(target: object): boolean {
  const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, target) ?? [];
  return guards.includes(JwtAuthGuard);
}

/**
 * Marca como "bearer" as rotas protegidas pelo JwtAuthGuard (JWT, OIDC ou API
 * key sk_...), a partir dos guards reais de cada controller — a documentação
 * não diverge da autorização efetiva.
 */
export function markAuthenticatedRoutes(app: INestApplication): void {
  const scanner = new MetadataScanner();
  const controllers = new Set<new (...args: never[]) => object>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (wrapper.metatype)
        controllers.add(wrapper.metatype as new (...args: never[]) => object);
    }
  }
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, object>;
    const classGuarded = usesJwtGuard(controller);
    for (const method of scanner.getAllMethodNames(prototype)) {
      if (classGuarded || usesJwtGuard(prototype[method])) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
        ApiBearerAuth(BEARER)(
          prototype,
          method,
          descriptor as PropertyDescriptor,
        );
      }
    }
  }
}

export function buildOpenApiDocument(
  app: INestApplication,
  version: string,
): OpenAPIObject {
  markAuthenticatedRoutes(app);
  const config = new DocumentBuilder()
    .setTitle('Organator Cloud — Control Plane API')
    .setDescription(
      'API do control plane: tenants, billing, provisionamento, isolamento de dados, ' +
        'IAM e auditoria. Autentique com `Authorization: Bearer <token>`, usando o JWT ' +
        'retornado por `POST /v1/auth/login` ou uma API key (`sk_...`) com os escopos necessários.',
    )
    .setVersion(version)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description: 'JWT de sessão ou API key (sk_...)',
      },
      BEARER,
    )
    .build();
  return SwaggerModule.createDocument(app, config, {
    autoTagControllers: true,
  });
}

/** Publica a UI em /docs e o documento em /docs/openapi.json. */
export function setupApiDocs(app: INestApplication, version: string): void {
  const document = buildOpenApiDocument(app, version);
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: `${API_DOCS_PATH}/openapi.json`,
    yamlDocumentUrl: `${API_DOCS_PATH}/openapi.yaml`,
  });
}
