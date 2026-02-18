# Knowledge Innovations WhatsApp AI Chatbot – Implementation Plan

_Last updated: February 18, 2026_

## 1. Project Overview
- **Objective:** Deploy a WhatsApp-based AI concierge that automates Ghana real estate inquiries, qualifies leads, schedules viewings, and escalates seamlessly to human agents.
- **Target KPIs:**
  - 70% faster first-response time
  - Capture 80% of inbound leads 24/7
  - <2s average bot response latency, 99.9% uptime
- **Core stack:** Node.js + Express backend, WhatsApp Business Cloud API, OpenAI GPT-4o mini (LLM), optional Microsoft Dynamics 365 CRM sync, cloud hosting (AWS/GCP).

## 2. Completed Work (Phase 1)
| Area | Description | Outcome |
| --- | --- | --- |
| Webhook + Message Handling | Verification, incoming message parsing, structured logging | ✅ Operational |
| Conversational Memory | Per-user context maintained for GPT prompts | ✅ In place |
| AI Persona & Prompts | System prompt enforces KI tone, data capture, escalation rules | ✅ Implemented |
| Inventory Intelligence | Lightweight Ghana property catalog injected into GPT context | ✅ Implemented |
| Lead Extraction | Structured JSON extraction + scoring + preference backfill | ✅ Implemented |
| Proactive Flows | Property suggestions, viewing scheduler link, escalation messaging | ✅ Live |

## 3. Phase 2 – CRM & Lead Pipeline (In Progress)
### 3.1 Goals
1. Persist qualified leads beyond in-memory store.
2. Sync high-intent leads to Microsoft Dynamics 365 (or interim datastore).
3. Provide internal tooling to view/triage captured leads.

### 3.2 Tasks & Steps
| Step | Description | Expected Output |
| --- | --- | --- |
| 2.1 | Introduce secure config handling for CRM endpoints/API keys (.env) | `.env` entries + validation guards |
| 2.2 | Abstract lead model (status, score, metadata, timestamps) | `leadService` module + unit tests |
| 2.3 | Implement persistence layer (start with JSON/SQLite, upgradeable to Dynamics) | Repository storing/retrieving leads |
| 2.4 | Build Microsoft Dynamics integration hook (REST) with retry/backoff | Successful POST/patch with logging |
| 2.5 | Add admin endpoint (auth-protected) to list/search/export leads | `/admin/leads` API returning filtered results |
| 2.6 | Monitoring + alerting for sync failures | Console + optional webhook notifications |

### 3.3 Acceptance Criteria
- Leads scoring ≥80 are stored durably and synced to CRM within 5 minutes.
- Sync retries on failure up to 3x with exponential backoff.
- Admin endpoint returns paginated JSON with filtering by score, status, or date.
- Sensitive tokens pulled only from environment variables; missing config triggers startup error.

## 4. Phase 3 – Analytics, Dashboard & Testing (Pending)
### 4.1 Goals
- Provide visibility into engagement metrics and funnel performance.
- Validate system resiliency via automated tests and structured UAT scenarios.

### 4.2 Tasks & Steps
| Step | Description | Expected Output |
| --- | --- | --- |
| 3.1 | Instrument key events (message received, lead qualified, viewing requested, escalation) | Metrics emitter (e.g., Prometheus or custom log schema) |
| 3.2 | Build lightweight analytics dashboard (Next.js/React) or integrate with BI tool | Charts for daily conversations, response times, qualification rate |
| 3.3 | Author unit + integration tests (Jest) covering webhook, lead pipeline, CRM adapter | 80%+ coverage on critical modules |
| 3.4 | Create UAT playbook with 50+ scripted scenarios (buy/rent, budget ranges, escalation, errors) | Shared doc/checklist |
| 3.5 | Load/performance testing to confirm <2s latency up to 1,000 conversations/day | Test report + tuning recommendations |

### 4.3 Acceptance Criteria
- Dashboard refreshes hourly (or real-time) with drill-down for lead sources.
- Automated test suite runs in CI and blocks failing builds.
- UAT sign-off requires ≥95% pass rate across scenarios, with defect tracking for any misses.
- Observability alerts on response latency >2s or error rate >2% over 5-minute windows.

## 5. Security & Compliance Checklist
- [ ] Enforce HTTPS-only endpoints + verify Facebook signatures.
- [ ] Rotate OpenAI/Meta/CRM credentials regularly and store in vault/secret manager.
- [ ] Implement rate limiting + abuse detection on webhook endpoints.
- [ ] Add consent messaging for data capture; allow opt-out (`STOP`).
- [ ] Ensure GDPR/CCPA data deletion workflows (manual for MVP, automated later).
- [ ] Review logging to prevent PII leakage (mask phone numbers beyond last 4 digits).

## 6. Deployment & Operations
| Area | Expectation |
| --- | --- |
| Hosting | Containerized Node.js service on AWS ECS/Fargate or GCP Cloud Run |
| CI/CD | GitHub Actions or Azure DevOps pipeline for lint/test/deploy |
| Blue/Green | Staged rollout to avoid downtime |
| Monitoring | CloudWatch/Stackdriver + custom metrics & alert hooks |
| SLA | 99.9% uptime, <2s response time target |

## 7. Next Deliverables
1. **Lead persistence module** (Node service + tests)
2. **Microsoft Dynamics sync adapter** (config-driven)
3. **Admin/ops endpoint** for lead inspection/export
4. **Analytics instrumentation plan** draft
5. **Automated test scaffold** (Jest + sample cases)

---
_This document will be updated as milestones complete. Ping the team channel after each phase merge to attach metrics snapshots and UAT notes._
