# Hardening do Runtime da API

## Escopo

Implementar a primeira parte da issue #121: proteção do runtime NestJS/Fastify.
Inclui validação de configuração de segurança, CORS por allowlist, validação
global de requests, limites de payload, headers HTTP e rate limiting. KMS,
secret store e manifests Kubernetes ficam fora deste recorte.

## Configuração

Um módulo de configuração centralizará variáveis de segurança. Em produção a
API falhará antes de escutar a porta se `JWT_SECRET`, `ENCRYPTION_KEY` ou
`CORS_ORIGINS` estiverem ausentes, usarem valores de desenvolvimento ou não
atenderem ao formato esperado. `CORS_ORIGINS` será uma lista CSV de origins
HTTP(S), sem wildcard.

`JWT_SECRET` exigirá ao menos 32 caracteres e não poderá corresponder ao valor
fallback atual. `ENCRYPTION_KEY` exigirá 64 caracteres hexadecimais. Em
desenvolvimento, os defaults continuam permitidos para preservar o fluxo local.

## Pipeline HTTP

O bootstrap aplicará:

- CORS apenas às origins configuradas, com métodos e headers explícitos;
- `ValidationPipe` global com `whitelist`, `forbidNonWhitelisted` e
  transformação habilitadas;
- limite de corpo de 1 MiB no adaptador Fastify;
- `@fastify/helmet` para headers de segurança;
- `@fastify/rate-limit`, por IP, com teto global e regra mais permissiva para
  `GET /health`.

As configurações terão defaults adequados somente fora de produção e poderão
ser substituídas por variáveis de ambiente sem alterar código.

## Testes

Testes unitários validarão configurações aceitas e rejeitadas. Testes de
integração criarão uma aplicação Fastify e comprovarão: origin permitida e
negada, payload desconhecido negado, headers de segurança presentes, payload
acima do limite rejeitado e limite de requisições aplicado.

## Compatibilidade e rollout

O contrato de ambiente será documentado em `.env.example`. A mudança de CORS
é breaking para origins não declaradas, portanto produção deve definir
`CORS_ORIGINS` antes do deploy. Não há migração de banco, eventos externos ou
alteração de autorização neste recorte.
