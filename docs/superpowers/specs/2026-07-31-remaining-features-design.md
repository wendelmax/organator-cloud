# Design Document: Remaining Features (#4, #7, #8, #9)

## 1. Executive Summary
This design doc specifies the implementation of the four remaining feature issues in `organator-cloud`:
1. **Issue #4**: Real Cloud SDK Integration (AWS EC2, Vercel REST API, VPS Docker SSH).
2. **Issue #7**: Developer Portal & OpenAPI Spec Management (CRUD, upload, rendering).
3. **Issue #8**: Deployment History & Real-Time Logs Tracking (Worker Prisma updates, NestJS API, Frontend logs UI).
4. **Issue #9**: Billing Dashboard & Stripe Customer Portal Integration.

---

## 2. System Architecture & Component Design

### Component 1: Cloud SDKs & Worker Deployments (Issues #4 & #8)
- **`@organator/cloud-providers`**:
  - `AWSClient`: Complete `createEC2Instance` utilizing `@aws-sdk/client-ec2`'s `RunInstancesCommand`.
  - `VercelClient`: Real HTTP calls with `axios` to `https://api.vercel.com` for project creation, environment variable injection, and deployment triggering.
  - `VPSClient`: Handle SSH connections, command execution, and Docker container deployment safely.
- **`provisioner-worker`**:
  - Initialize `PrismaClient` from `@organator/core-models`.
  - When `deploy-microservice` or `deploy-tenant-infra` job runs:
    1. Create a `Deployment` record with status `RUNNING`.
    2. Append progress messages to `Deployment.logs`.
    3. Update `Deployment` status to `SUCCESS` or `FAILED` upon job completion.

### Component 2: Control Plane API Endpoints (NestJS)
- **Services Module (`apps/control-plane-api/src/services`)**:
  - `GET /v1/services/:id/deployments`: Return all deployment history & logs for a microservice.
  - `POST /v1/services/:id/deploy`: Trigger a new deployment job in BullMQ and return the created `Deployment`.
- **Docs Module (`apps/control-plane-api/src/docs`)**:
  - Create `DocsModule` with `DocsController` and `DocsService`.
  - `POST /v1/docs`: Upload and store OpenAPI spec JSON/YAML for a microservice.
  - `GET /v1/docs/service/:microserviceId`: Fetch docs associated with a microservice.
  - `PATCH /v1/docs/:id/visibility`: Toggle `isPublic` flag.
- **Billing Module (`apps/control-plane-api/src/billing`)**:
  - Create `BillingModule` with `BillingController` and `BillingService`.
  - `POST /v1/billing/create-portal-session`: Generate a Stripe Customer Portal session URL.
  - `GET /v1/billing/subscription`: Fetch tenant plan, status, and invoices from Stripe.

### Component 3: Frontend Backoffice (Next.js)
- **Service Details & Logs (`apps/backoffice-web/src/app/(dashboard)/services/[id]/page.tsx` & `ClientPage.tsx`)**:
  - Fetch service details and deployment history.
  - Render terminal log viewer for selected deployment and trigger manual deploys.
- **Developer Portal (`apps/backoffice-web/src/app/(dashboard)/portal/page.tsx`)**:
  - List registered OpenAPI specifications.
  - Modal form for uploading/pasting OpenAPI JSON/YAML specs.
  - Render Swagger / OpenAPI documentation UI.
- **Billing Page (`apps/backoffice-web/src/app/(dashboard)/billing/page.tsx`)**:
  - Display tenant plan overview and invoice history.
  - Button to redirect to Stripe Customer Portal.

---

## 3. Verification Plan
- Build all monorepo packages with `npx turbo run build`.
- Run unit/integration tests for API modules.
