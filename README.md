# Health Stack — 1 Person, 1 QR

A consent-first digital health record. Every patient gets a unique **Patient ID + QR code**.
At any hospital, pharmacy or lab, the provider scans the QR (or types the ID), the patient
approves the request on their phone, and the provider gets **time-boxed, role-scoped** access
to the patient's history. Prescriptions, lab orders and results flow straight back into the
patient's own timeline.

> Team project (3 members). Started as **PillMatrix** during a 24-hour hackathon
> (VIT × Gemini, track given on the spot, built on Firebase), then redesigned as Health Stack
> on Supabase/PostgreSQL. Ideas, building and debugging were shared across the team.

## The problem

Medical history lives on paper. Travel, forget a prescription or switch hospitals, and you
repeat scans, X-rays and tests because the new doctor can't see the old results. Pharmacists
rightly refuse prescription-only medicines without the slip. In an emergency, nobody knows
your allergies or current medication.

## How it works

```
Provider scans patient QR / enters Patient ID
        │
        ▼
Consent request (PENDING) ──► realtime prompt on the patient's phone
        │
   APPROVE ─► access granted: time-boxed (e.g. 30 min), scoped to the provider's role
   DENY / timeout ─► no access
```

- **Doctor:** reads history, writes diagnosis + prescription, orders labs. Every prescription
  passes a **safety check** (allergy conflicts, including drug-class allergies, and interactions with active medications) before it is saved.
- **Pharmacist** *(designed here; screens in v1)* sees only the prescription and the prescribing doctor; can propose an
  alternative medicine, which the patient accepts or rejects.
- **Lab** *(designed here; screens in v1)* sees only the ordered test and uploads the result to the patient's timeline.
- **Emergency break-glass:** a verified clinician can open emergency-relevant records for an
  unconscious patient. Access is time-boxed, every action is logged immutably, and the patient
  is notified and re-verifies later before the notes are merged into their record.
- **Daily check-in** for at-risk patients, confirmed with a WebAuthn platform authenticator
  (fingerprint/face) so it proves the *patient* checked in; a missed check-in notifies a caregiver.

The full design (actors, state machines, data model) is in [workflow.md](workflow.md).

## What is built (status)

| Area | Status |
|---|---|
| Registration, roles, Patient ID + QR, QR scanner | built |
| Consent gate with realtime approval, expiry | built |
| Patient app: home, history timeline, activity log, consent prompts, check-in | built |
| Doctor: consult, prescription composer with safety check, AI record summary | built |
| Emergency break-glass + emergency audit log | built |
| Pharmacist and lab screens | DB tables + RPCs here; full dashboards exist in the PillMatrix (v1) codebase, not yet ported |
| Caregiver dashboard, SMS/phone escalation, ABDM (ABHA) integration | roadmap |

## Security model

Authorization lives in the database, not the UI:

- **Row-Level Security on 18 tables, 45 policies.** Helper functions such as `has_consent()`,
  `has_emergency_access()`, `is_verified_provider()` and `is_caregiver_of()` decide every read/write.
- Sensitive steps run as Postgres RPCs (`request_consent`, `safety_check`,
  `start_emergency_access`, `merge_emergency_access`, `expire_stale_consents`).
- The emergency-access action log is append-only (a trigger blocks updates and deletes).
- AI keys stay server-side (`server/ai.js`); the app works without AI, falling back to
  rules-only safety checks and no summary.

## Stack

React 18 + Vite + Tailwind (PWA) · Supabase (PostgreSQL, Auth, Realtime, RLS) ·
Express API for AI calls (Groq or Gemini) · `qrcode` / `html5-qrcode` · WebAuthn

## Run locally

```bash
npm install
cp .env.example .env          # fill in the values printed by the next step
npm run db:start              # local Supabase (needs Docker + Supabase CLI)
npm run db:reset              # apply migrations + seed data
npm run dev                   # web on :5173, AI API on :8787
```

## Background

PillMatrix (v1) was built on Firebase with a React web portal for doctors, pharmacists and
labs and a React Native patient app. After a mentor pointed us to India's ABDM / ABHA health
ID, we redesigned it around consent, role-scoping and emergency access, and moved to
PostgreSQL so access rules could be enforced with RLS. This is a hackathon pilot: one hospital
network, one central database, not a production medical system.
