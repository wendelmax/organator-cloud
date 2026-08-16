# Design Spec: Deployment Strategies, Auto-Healing & Telemetry Suite (Issues #38, #39, #40)

**Features:** Deployment Strategies (#38), Provisioner Auto-Healing & Circuit Breaker (#39), Provisioner Observability Dashboard (#40)  
**Status:** Approved  
**Date:** 2026-08-16  

---

## 1. Executive Summary

This document specifies the design for the final deployment and observability capabilities of Milestone **v2.2.0 — Provisioner & Providers One-Click**. It establishes zero-downtime deployment strategies (`BLUE_GREEN`, `CANARY`, `ROLLBACK`) (#38), provider circuit breakers and exponential backoff retry mechanisms (#39), and native worker telemetry and circuit monitoring dashboards in `backoffice-web` (#40).

---

## 2. Prisma Data Schema (`DeploymentStrategy` & `ProviderCircuitBreaker`)

```prisma
enum DeploymentStrategy {
  REBUILD
  BLUE_GREEN
  CANARY
  ROLLBACK
}

enum CircuitState {
  CLOSED
  HALF_OPEN
  OPEN
}

model Deployment {
  id              String             @id @default(uuid())
  microserviceId  String
  microservice    Microservice       @relation(fields: [microserviceId], references: [id], onDelete: Cascade)
  version         String
  strategy        DeploymentStrategy @default(REBUILD)
  rolloutConfig   Json?
  phase           String             @default("PENDING")
  logs            String             @default("")
  actorId         String?
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
}

model ProviderCircuitBreaker {
  id              String       @id @default(uuid())
  provider        String       @unique // DOCKER, AWS, TERRAFORM
  state           CircuitState @default(CLOSED)
  failureCount    Int          @default(0)
  lastFailureAt   DateTime?
  nextAttemptAt   DateTime?
  updatedAt       DateTime     @updatedAt
}
```

---

## 3. Worker Handlers & Circuit Breaker Logic (`provisioner-worker`)

1. **`deploy-microservice` Rollout Strategies (Issue #38):**
   - `BLUE_GREEN`: Deploys new target instance on temporary port, validates HTTP `/health`, switches routing, and terminates old instance.
   - `CANARY`: Progressively shifts traffic weights (10% → 50% → 100%). Triggers automatic rollback if healthcheck fails at any step.
   - `ROLLBACK`: Restores last known `SUCCESS` deployment artifact.
2. **Auto-Healing & Circuit Breaker (Issue #39):**
   - Tracks provider failure counts (`CLOSED` → `OPEN` after 5 consecutive failures within 1 minute → `HALF_OPEN` after 30s cooldown).
   - Retries failed jobs with exponential backoff for transient I/O network errors.
3. **Telemetry & Metrics (Issue #40):**
   - Publishes worker job latency, error rate, and active queue counts to `/metrics`.

---

## 4. Control Plane API & UI Integration

### 4.1 Endpoints (`control-plane-api`)
- `POST /v1/services/:id/deploy` — Accepts `strategy` (`BLUE_GREEN`, `CANARY`, `ROLLBACK`) and `rolloutConfig`.
- `GET /v1/platform/provisioner/telemetry` — Returns worker job telemetry and provider circuit status.
- `POST /v1/platform/provisioner/circuit-breaker/reset` — Resets a provider's circuit breaker state.

### 4.2 UI Components (`backoffice-web`)
- **Deployment Modal in `/services/[id]`:** Strategy selection dropdown (`Rebuild`, `Blue/Green`, `Canary`, `Rollback`) and step preview.
- **Worker Telemetry Dashboard in `/settings`:** Live indicators displaying BullMQ worker queue state, job latencies, error rates, and circuit breaker controls.
