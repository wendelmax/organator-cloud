# Deploy em Kubernetes (Helm)

Este guia instala o Organator Cloud — API (`control-plane-api`), worker de
provisionamento (`provisioner-worker`) e painel (`backoffice-web`) — com o chart
em `helm/organator-cloud`.

## Pré-requisitos

- Kubernetes 1.27+ e Helm 3.12+
- Um Ingress Controller (o padrão do chart é `nginx`)
- Imagens publicadas: as tags `vX.Y.Z` do repositório geram
  `ghcr.io/wendelmax/organator-cloud/<app>:X.Y.Z` (workflow `CD`). O chart usa a
  `appVersion` como tag padrão.

## 1. Secrets da aplicação

Crie o Secret **antes** de instalar. Nunca reutilize valores de desenvolvimento:

```bash
kubectl create namespace organator
kubectl -n organator create secret generic organator-cloud-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=NEXTAUTH_SECRET="$(openssl rand -hex 32)"
```

| Chave | Uso |
|---|---|
| `JWT_SECRET` | Assina os tokens da API (mín. 32 caracteres) |
| `ENCRYPTION_KEY` | AES-256-GCM das credenciais de provedores e conexões de tenants (64 hex). **Guarde com backup**: perder a chave torna as credenciais cifradas irrecuperáveis |
| `NEXTAUTH_SECRET` | Sessões do painel |

## 2. Valores mínimos

`my-values.yaml`:

```yaml
ingress:
  hosts:
    web: admin.suaempresa.com
    api: api.suaempresa.com
  tls:
    - secretName: organator-tls
      hosts: [admin.suaempresa.com, api.suaempresa.com]

controlPlaneApi:
  env:
    CORS_ORIGINS: "https://admin.suaempresa.com"
    # Restrinja ao CIDR dos pods do seu ingress, se souber.
    TRUST_PROXY: "10.0.0.0/8"
  extraEnv:
    - name: STRIPE_SECRET_KEY
      valueFrom: { secretKeyRef: { name: organator-stripe, key: STRIPE_SECRET_KEY } }
    - name: STRIPE_WEBHOOK_SECRET
      valueFrom: { secretKeyRef: { name: organator-stripe, key: STRIPE_WEBHOOK_SECRET } }
```

### Banco e Redis gerenciados (recomendado em produção)

```yaml
postgresql:
  enabled: false
externalDatabase:
  existingSecret: organator-db   # chave DATABASE_URL com a connection string completa
redis:
  enabled: false
externalRedis:
  host: my-redis.cache.amazonaws.com
  port: 6379
```

## 3. Instalar

```bash
helm dependency build helm/organator-cloud
helm upgrade --install organator helm/organator-cloud -n organator -f my-values.yaml
```

O que acontece:

1. Cada pod da API roda `prisma migrate deploy` num **initContainer** antes de
   subir. Réplicas concorrentes são seguras (o Prisma usa advisory lock). Para
   rodar migrações por fora, use `controlPlaneApi.migrations.enabled=false`.
2. A API só recebe tráfego quando `GET /health/ready` confirma Postgres e Redis.
   `GET /health` é o liveness e não depende de serviços externos.
3. No primeiro boot a API cria o admin da plataforma (`PLATFORM_ADMIN_EMAIL`,
   padrão `admin@organator.app`) com uma senha temporária impressa **uma única
   vez** nos logs:

   ```bash
   kubectl -n organator logs deploy/organator-organator-cloud-control-plane-api | grep BOOTSTRAP
   ```

   A troca de senha é obrigatória no primeiro login.

## Operação

- **Upgrades**: `helm upgrade` aplica as migrações novas antes de trocar os pods.
- **Proxy reverso**: `TRUST_PROXY` define quem pode informar `X-Forwarded-For`
  (o rate limit é por IP). `TRUST_PROXY_HOPS` ainda é aceito, mas está
  obsoleto: no Fastify ≥ 5.12 contagem de hops não é suportada e o valor > 0
  passa a significar "proxies de rede privada".
- **Métricas**: o worker expõe Prometheus em `:9464/metrics` (anotações
  `prometheus.io/*` no pod).
- **Segurança**: todos os containers rodam como usuário não-root (uid 1000),
  sem escalonamento de privilégio e com todas as capabilities removidas.

## Limitação conhecida

O painel ainda lê `NEXT_PUBLIC_API_URL` no **build** da imagem para as chamadas
feitas pelo navegador, então imagens pré-construídas apontam para o endereço
padrão. Isso está sendo migrado para configuração de runtime.
