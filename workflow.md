# Health Stack — System Workflow

This document explains how Health Stack works end to end: the actors, the consent-first
access model, each role's flow, the emergency and check-in subsystems, the data model, and
the state machines. It is the reference the build should follow.

Everything here is scoped to the **hackathon pilot** (one hospital network, centralized DB).
Sections marked _[Roadmap]_ are designed but not built for the demo.

---

## 1. Actors

| Actor | Interface | Core job |
|---|---|---|
| 👤 Patient | Mobile / PWA | Owns the record, approves every access, checks in daily (if at-risk) |
| 🩺 Doctor | Web app | Scans QR, reads history, adds diagnosis + prescription, orders labs |
| 💊 Pharmacist | Web app | Scans QR, views prescription, dispenses / suggests alternatives |
| 🔬 Lab / Scan Tech | Web app | Scans QR, sees only the ordered test, uploads results |
| 👨‍👩‍👧 Caregiver | Web dashboard | Monitors at-risk patients' daily check-ins, receives escalations |

**The one rule that governs everything:** no actor sees a patient's data without that
patient's explicit, real-time approval — every time — except through the audited emergency
break-glass path.

---

## 2. Core Principle — Consent-First Access

Every data access follows the same gate:

```
Provider scans patient QR (or enters Patient ID)
        │
        ▼
Server creates a CONSENT REQUEST (status = PENDING)
        │
        ▼
Patient's device receives a realtime notification:
   "Dr. Rao is requesting access to your records. Allow?"
        │
   ┌────┴─────────────┐
   ▼                  ▼
 APPROVE            DENY / timeout
   │                  │
   ▼                  ▼
Access granted,    No access.
time-boxed         Request closed.
(e.g. 30 min),
scoped to role
```

- Consent is **per-visit**, never standing or automatic.
- Consent is **time-boxed** — access expires automatically.
- Consent is **role-scoped** — a lab sees only the ordered test; a pharmacist sees only the
  prescription; a doctor sees the full record.
- The realtime notification is powered by the DB's realtime subscriptions (Supabase),
  so approval feels instant.

---

## 3. Role Workflows

### 3.1 Patient
1. One-time registration → issued a permanent **Patient ID** + **QR code** (Aadhaar-linked in
   production; simulated in pilot).
2. Profile: name, age, blood group, weight, height, allergies (extendable).
3. Home: shows QR + Patient ID. History page: past visits, current medications, lab reports,
   doctor chat. Every incoming consent request appears here as an approve/deny prompt.
4. **Edge cases:** minors → guardian consent; no smartphone → assisted mode (caregiver/front-desk
   approves via OTP on a linked number).

### 3.2 Doctor
1. Scan patient QR → consent request fires → on approval, full record unlocks.
2. Read history. **One-tap AI summary** condenses the raw record.
3. Enter diagnosis + prescription. **On prescribe, the safety check runs**: the prescription is
   cross-checked against the patient's recorded allergies and current medications; conflicts are
   flagged in real time (e.g. "⚠ Conflicts with recorded penicillin allergy").
4. Optionally order a lab test (specifying test type + body part) → creates a scoped lab order.
5. Optionally refer to a specialist (verified doctors only).

### 3.3 Pharmacist
1. Scan QR → consent gate → view the prescription (medicine, dosage, quantity).
2. Mark items in-stock / dispensed.
3. **If unavailable:** app suggests a same-composition alternative →
   - Patient can approve the swap directly, OR
   - Escalate to the prescribing doctor for confirmation.
   - If neither approves, the item is sourced elsewhere; that item's transaction ends.

### 3.4 Lab / Scan Center
1. Doctor's order already specifies the exact test + body part.
2. Lab scans QR → consent gate → sees **only** the ordered test — nothing else.
3. Upload results (structured fields + media for scans).
4. **Patient** is notified the report is ready (not the doctor — patient stays in control).
5. Doctor sees the result on next QR scan, or remotely if permitted.

---

## 4. Emergency Break-Glass Workflow

Used when a patient can't authenticate (unconscious, no QR) and treatment can't wait.
Follows the recognised health-IT break-glass pattern — an accountable override, not a bypass.

```
Clinician triggers EMERGENCY ACCESS
        │
        ▼
System checks: is clinician a verified, licensed provider?  ── no ──► blocked
        │ yes
        ▼
Elevated, TIME-BOXED access granted to ONLY emergency-relevant records
        │
        ▼
Every action logged immutably: time, clinician ID, patient, actions, justification
        │
        ▼
Treatment proceeds. All notes written to clinician's dashboard first.
        │
        ▼
Patient re-authenticates via QR later
        │
        ▼
Verification step (prevent misidentification) → records MERGED into permanent record
        │
        ▼
Patient NOTIFIED of the emergency access on the record's activity log
```

Properties: **restricted** (licensed clinicians only), **audited** (immutable log),
**least-necessary disclosure** (emergency-relevant records only), **time-boxed** (expires),
**transparent** (patient notified).

---

## 5. Daily Check-In Workflow (Dead-Man's-Switch)

Opt-in for at-risk patients (elderly, chronic, living alone). Proof-of-life via biometric,
so it confirms the *patient* checked in — not just that a phone was tapped.

```
08:00  Server marks patient PENDING
        │
        ▼
Check-in prompt (high-priority notification)
        │
   ┌────┴────────────┐
   ▼                 ▼
 Responds          Ignored
   │                 │
   ▼                 ▼
Symptom form     Reminder every 10 min
(None / Fever /      │
 Chest pain / …)     │
   │                 │
   ▼                 │
Biometric confirm    │
(fingerprint/face)   │
   │                 │
   ▼                 ▼
 SAFE 🟢       No check-in →
 (dashboard    ESCALATION (below)
  green)
```

**Escalation ladder** (fast-forwardable in demo via a "simulate missed check-in" trigger):

```
+30 min  no check-in → status REMINDER   → dashboard 🟡 yellow
+60 min  no check-in → notify caregiver  → push / (SMS/call [Roadmap])
+120 min no check-in → CRITICAL          → dashboard 🔴 red
```

Caregiver dashboard shows each patient card: name, status (🟢/🟡/🔴), last check-in time,
last activity, battery. Actions: call patient, view symptoms, view history, emergency contact.

_[Roadmap]_ continuous OEM-proof alarm, Activity Recognition passive backup, real SMS/phone
escalation, offline store-and-forward, battery heartbeat. Pilot uses a high-priority
notification + web push instead of a full native alarm.

---

## 6. Data Model (pilot)

```
users                (id, role, name, email, verified)          role ∈ {patient,doctor,pharmacist,lab,caregiver}
patients             (id, user_id, qr_token, age, blood_group, weight, height)
allergies            (id, patient_id, substance)                -- feeds the safety check
medications          (id, patient_id, name, active, started_at) -- current meds, feeds safety check
consent_requests     (id, patient_id, requester_id, requester_role, scope, status, created_at, expires_at)
                                                                  status ∈ {pending,approved,denied,expired}
encounters           (id, patient_id, doctor_id, diagnosis, notes, created_at)
prescriptions        (id, encounter_id, patient_id, doctor_id, status, created_at)
prescription_items   (id, prescription_id, medicine, composition, dosage, quantity, dispense_status)
                                                                  dispense_status ∈ {prescribed,dispensed,substituted,sourced_elsewhere}
lab_orders           (id, encounter_id, patient_id, ordered_by, test_type, body_part, status)
                                                                  status ∈ {ordered,sampled,result_uploaded,reviewed}
lab_results          (id, lab_order_id, result_json, media_url, uploaded_at)
emergency_access     (id, patient_id, clinician_id, justification, actions_json, created_at, expires_at, merged)
checkins             (id, patient_id, date, status, symptoms_json, severity, verified_at, activity, battery)
                                                                  status ∈ {pending,safe,reminder,critical}
medicine_stock       (id, pharmacy_id, composition, quantity)    -- for alternative suggestion
```

---

## 7. State Machines

**Consent**
```
(none) → PENDING → APPROVED → EXPIRED
            │  └────────────► REVOKED
            └──► DENIED
```

**Prescription item**
```
PRESCRIBED → DISPENSED
          → SUBSTITUTED (same composition, approved)
          → SOURCED_ELSEWHERE
```

**Lab order**
```
ORDERED → SAMPLED → RESULT_UPLOADED → REVIEWED
```

**Check-in**
```
PENDING → SAFE 🟢
       → REMINDER 🟡 → CRITICAL 🔴
```

---

## 8. System Architecture (pilot)

```
   Patient PWA        Doctor Web       Pharmacy Web      Lab Web       Caregiver Web
        │                 │                │               │                │
        └────────┬────────┴────────┬───────┴───────┬───────┴────────┬───────┘
                 │                  │               │                │
                 ▼                  ▼               ▼                ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │            Backend API  (Supabase: Auth + Postgres + Realtime)   │
        │   consent gate · records · prescriptions · labs · emergency log  │
        └──────────────┬───────────────────────────────┬──────────────────┘
                       │                                │
                       ▼                                ▼
              AI service (Groq/Gemini)         Realtime channel
        summary + prescription safety check    (instant consent notify)
```

- **Realtime subscriptions** drive the instant consent notification and the live caregiver
  dashboard.
- **AI service** does two things: summarize a record on demand, and run the allergy/interaction
  safety check at prescribe-time (rules + composition match, LLM for explanation).
- Centralized DB is a **deliberate pilot choice** to isolate the consent/experience variable.
  _[Roadmap]_ federated HIU/HIP layer plugging into ABDM.

---

## 9. Build Priority (demo spine first)

1. **Auth + roles + registration** → Patient ID + QR.
2. **Consent gate** with realtime notify (doctor scan → patient approve).
3. **Doctor flow**: view record → add diagnosis + prescription → **safety check fires**.
4. **Pharmacy flow**: scan → view prescription → dispense / suggest alternative.
5. **Lab flow**: scoped order view → upload result → patient notified.
6. **Caregiver dashboard + check-in loop** with **simulate-missed-check-in** trigger.
7. **Emergency break-glass** with audit log screen.
8. AI summary, referrals, stock management → stretch.

Steps 1–3 are the minimum that tells the story. Everything after is depth added in priority order.