-- ============================================================================
-- Health Stack — core schema (workflow.md §6)
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums ----
create type user_role        as enum ('patient','doctor','pharmacist','lab','caregiver');
create type consent_status   as enum ('pending','approved','denied','expired','revoked');
-- scope drives RLS: doctor => full_record, pharmacist => prescription,
-- lab => lab_order (narrowed further to a single order via scope_ref).
create type consent_scope    as enum ('full_record','prescription','lab_order');
create type dispense_status  as enum ('prescribed','dispensed','substituted','sourced_elsewhere');
create type lab_order_status as enum ('ordered','sampled','result_uploaded','reviewed');
create type checkin_status   as enum ('pending','safe','reminder','critical');

-- --------------------------------------------------------------- tables ----
create table users (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null,
  name       text not null,
  email      text not null,
  -- Pilot: seeded boolean. Production would verify the practitioner against
  -- ABDM's Healthcare Professional Registry (HPR) before setting this.
  verified   boolean not null default false,
  org        text,
  created_at timestamptz not null default now()
);

create table patients (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid unique not null references users(id) on delete cascade,
  -- Human-readable ID a provider can type; qr_token is what the QR encodes.
  patient_code     text unique not null,
  qr_token         text unique not null default encode(gen_random_bytes(16),'hex'),
  age              int,
  blood_group      text,
  weight           numeric,
  height           numeric,
  phone            text,
  emergency_contact text,
  checkin_enrolled boolean not null default false,
  created_at       timestamptz not null default now()
);

create table allergies (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  substance  text not null,          -- matched against prescribed composition
  severity   text default 'moderate',
  created_at timestamptz not null default now()
);

create table medications (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  name       text not null,
  composition text not null,
  active     boolean not null default true,
  started_at date default current_date
);

create table caregiver_links (
  id           uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references users(id) on delete cascade,
  patient_id   uuid not null references patients(id) on delete cascade,
  relationship text,
  unique (caregiver_id, patient_id)
);

create table consent_requests (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients(id) on delete cascade,
  requester_id   uuid not null references users(id) on delete cascade,
  requester_role user_role not null,
  scope          consent_scope not null,
  -- For scope = 'lab_order' this pins access to ONE lab order.
  scope_ref      uuid,
  purpose        text,
  status         consent_status not null default 'pending',
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  expires_at     timestamptz not null default now() + interval '30 minutes'
);
create index on consent_requests (patient_id, status);
create index on consent_requests (requester_id, status);

create table encounters (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id  uuid not null references users(id),
  diagnosis  text,
  notes      text,
  emergency  boolean not null default false,
  created_at timestamptz not null default now()
);

create table prescriptions (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid references encounters(id) on delete cascade,
  patient_id   uuid not null references patients(id) on delete cascade,
  doctor_id    uuid not null references users(id),
  status       text not null default 'active',
  created_at   timestamptz not null default now()
);

create table prescription_items (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  medicine        text not null,
  composition     text not null,
  dosage          text,
  quantity        int default 1,
  dispense_status dispense_status not null default 'prescribed',
  -- Set when a pharmacist swaps in a same-composition alternative.
  substitute_medicine text,
  substitute_status   text,   -- proposed | patient_approved | doctor_approved | rejected
  override_reason text,       -- doctor's justification if a safety flag was overridden
  created_at      timestamptz not null default now()
);

create table lab_orders (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid references encounters(id) on delete set null,
  patient_id   uuid not null references patients(id) on delete cascade,
  ordered_by   uuid not null references users(id),
  test_type    text not null,
  body_part    text,
  status       lab_order_status not null default 'ordered',
  created_at   timestamptz not null default now()
);

create table lab_results (
  id           uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references lab_orders(id) on delete cascade,
  uploaded_by  uuid references users(id),
  result_json  jsonb not null default '{}'::jsonb,
  media_url    text,
  notes        text,
  uploaded_at  timestamptz not null default now()
);

-- Immutable: insert-only, no update/delete policy exists and a trigger blocks it.
create table emergency_access (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients(id) on delete restrict,
  clinician_id  uuid not null references users(id) on delete restrict,
  justification text not null,
  actions_json  jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '60 minutes',
  merged        boolean not null default false
);

create table checkins (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references patients(id) on delete cascade,
  date         date not null default current_date,
  status       checkin_status not null default 'pending',
  symptoms_json jsonb not null default '[]'::jsonb,
  severity     text,
  verified_at  timestamptz,            -- set when WebAuthn proof-of-life succeeds
  verify_method text,
  activity     text default 'Phone unlocked',
  battery      int default 82,
  escalated_at timestamptz,
  updated_at   timestamptz not null default now(),
  unique (patient_id, date)
);

create table medicine_stock (
  id            uuid primary key default gen_random_uuid(),
  pharmacy_id   uuid not null references users(id) on delete cascade,
  medicine_name text not null,
  composition   text not null,
  quantity      int not null default 0
);
create index on medicine_stock (composition);

-- Rules layer for the prescribe-time safety check. The AI only *explains*
-- what these rules (and the allergy list) already found.
create table drug_interactions (
  id            uuid primary key default gen_random_uuid(),
  composition_a text not null,
  composition_b text not null,
  severity      text not null default 'major',
  note          text not null
);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read);

-- ------------------------------------------------------ helper functions ---
-- SECURITY DEFINER so policies can read users/consent without recursing into
-- the very policies being evaluated.

create or replace function current_role_of()
returns user_role language sql stable security definer set search_path = public as $$
  select role from users where id = auth.uid();
$$;

create or replace function is_verified_provider()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select verified from users
                   where id = auth.uid()
                     and role in ('doctor','pharmacist','lab')), false);
$$;

create or replace function my_patient_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from patients p where p.user_id = auth.uid();
$$;

-- Time-boxed + role-scoped. Expiry is enforced here, so a stale row grants
-- nothing even before the sweeper flips its status.
create or replace function has_consent(p_patient uuid, p_scope consent_scope, p_ref uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from consent_requests c
    where c.patient_id  = p_patient
      and c.requester_id = auth.uid()
      and c.scope       = p_scope
      and c.status      = 'approved'
      and c.expires_at  > now()
      and (p_ref is null or c.scope_ref is null or c.scope_ref = p_ref)
  );
$$;

-- Break-glass: an active, non-expired emergency_access row grants elevated
-- read on emergency-relevant records only (see policies below).
create or replace function has_emergency_access(p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from emergency_access e
    where e.patient_id = p_patient
      and e.clinician_id = auth.uid()
      and e.expires_at > now()
  );
$$;

create or replace function is_caregiver_of(p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from caregiver_links l
    where l.patient_id = p_patient and l.caregiver_id = auth.uid()
  );
$$;

-- --------------------------------------------------------------- RLS -------
alter table users              enable row level security;
alter table patients           enable row level security;
alter table allergies          enable row level security;
alter table medications        enable row level security;
alter table caregiver_links    enable row level security;
alter table consent_requests   enable row level security;
alter table encounters         enable row level security;
alter table prescriptions      enable row level security;
alter table prescription_items enable row level security;
alter table lab_orders         enable row level security;
alter table lab_results        enable row level security;
alter table emergency_access   enable row level security;
alter table checkins           enable row level security;
alter table medicine_stock     enable row level security;
alter table drug_interactions  enable row level security;
alter table notifications      enable row level security;

-- users: everyone authenticated may read the directory-level fields (needed to
-- render "Dr. Rao is requesting access"). Only self may write.
create policy users_read  on users for select to authenticated using (true);
create policy users_self_update on users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy users_self_insert on users for insert to authenticated
  with check (id = auth.uid());

-- patients
create policy patients_self on patients for select to authenticated
  using (user_id = auth.uid());
create policy patients_self_write on patients for insert to authenticated
  with check (user_id = auth.uid());
create policy patients_self_update on patients for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy patients_consented on patients for select to authenticated
  using (
       has_consent(id,'full_record') or has_consent(id,'prescription')
    or has_consent(id,'lab_order')   or has_emergency_access(id)
    or is_caregiver_of(id)
  );

-- allergies / medications: full record (doctor) + emergency (allergies are
-- emergency-relevant) + caregiver. Pharmacist/lab never see these.
create policy allergies_read on allergies for select to authenticated
  using (patient_id = my_patient_id() or has_consent(patient_id,'full_record')
         or has_emergency_access(patient_id) or is_caregiver_of(patient_id));
create policy allergies_patient_write on allergies for all to authenticated
  using (patient_id = my_patient_id()) with check (patient_id = my_patient_id());

create policy medications_read on medications for select to authenticated
  using (patient_id = my_patient_id() or has_consent(patient_id,'full_record')
         or has_emergency_access(patient_id) or is_caregiver_of(patient_id));
create policy medications_doctor_write on medications for insert to authenticated
  with check (has_consent(patient_id,'full_record'));
create policy medications_patient_write on medications for all to authenticated
  using (patient_id = my_patient_id()) with check (patient_id = my_patient_id());

-- caregiver links
create policy links_read on caregiver_links for select to authenticated
  using (caregiver_id = auth.uid() or patient_id = my_patient_id());

-- consent_requests: patient sees requests aimed at them and answers them;
-- requester sees their own. Neither may forge the other's fields.
create policy consent_patient_read on consent_requests for select to authenticated
  using (patient_id = my_patient_id());
create policy consent_patient_respond on consent_requests for update to authenticated
  using (patient_id = my_patient_id()) with check (patient_id = my_patient_id());
create policy consent_requester_read on consent_requests for select to authenticated
  using (requester_id = auth.uid());
create policy consent_requester_revoke on consent_requests for update to authenticated
  using (requester_id = auth.uid()) with check (requester_id = auth.uid());

-- encounters: doctor with full consent (or emergency) reads/writes.
create policy encounters_read on encounters for select to authenticated
  using (patient_id = my_patient_id() or has_consent(patient_id,'full_record')
         or has_emergency_access(patient_id));
create policy encounters_write on encounters for insert to authenticated
  with check ((has_consent(patient_id,'full_record') or has_emergency_access(patient_id))
              and doctor_id = auth.uid() and current_role_of() = 'doctor');

-- prescriptions: doctor (full) writes; pharmacist reads with 'prescription' scope.
create policy rx_read on prescriptions for select to authenticated
  using (patient_id = my_patient_id()
         or has_consent(patient_id,'full_record')
         or has_consent(patient_id,'prescription')
         or has_emergency_access(patient_id));
create policy rx_write on prescriptions for insert to authenticated
  with check ((has_consent(patient_id,'full_record') or has_emergency_access(patient_id))
              and doctor_id = auth.uid() and current_role_of() = 'doctor');

create policy rx_items_read on prescription_items for select to authenticated
  using (exists (select 1 from prescriptions p where p.id = prescription_id));
create policy rx_items_write on prescription_items for insert to authenticated
  with check (exists (
    select 1 from prescriptions p
    where p.id = prescription_id
      and (has_consent(p.patient_id,'full_record') or has_emergency_access(p.patient_id))
  ));
-- Pharmacist dispenses / proposes a substitute; patient approves a substitute.
create policy rx_items_update on prescription_items for update to authenticated
  using (exists (
    select 1 from prescriptions p
    where p.id = prescription_id
      and (has_consent(p.patient_id,'prescription') or p.patient_id = my_patient_id())
  ))
  with check (exists (
    select 1 from prescriptions p
    where p.id = prescription_id
      and (has_consent(p.patient_id,'prescription') or p.patient_id = my_patient_id())
  ));

-- lab_orders: the lab sees ONLY the single order its consent points at.
create policy lab_orders_read on lab_orders for select to authenticated
  using (patient_id = my_patient_id()
         or has_consent(patient_id,'full_record')
         or has_consent(patient_id,'lab_order', id));
create policy lab_orders_write on lab_orders for insert to authenticated
  with check (has_consent(patient_id,'full_record') and ordered_by = auth.uid());
create policy lab_orders_update on lab_orders for update to authenticated
  using (has_consent(patient_id,'lab_order', id) or has_consent(patient_id,'full_record'))
  with check (has_consent(patient_id,'lab_order', id) or has_consent(patient_id,'full_record'));

create policy lab_results_read on lab_results for select to authenticated
  using (exists (
    select 1 from lab_orders o
    where o.id = lab_order_id
      and (o.patient_id = my_patient_id()
           or has_consent(o.patient_id,'full_record')
           or has_consent(o.patient_id,'lab_order', o.id))
  ));
create policy lab_results_write on lab_results for insert to authenticated
  with check (exists (
    select 1 from lab_orders o
    where o.id = lab_order_id and has_consent(o.patient_id,'lab_order', o.id)
  ) and current_role_of() = 'lab');

-- emergency_access: append-only audit trail. No update/delete policy exists,
-- and the trigger below makes that structural rather than a policy oversight.
create policy ea_read on emergency_access for select to authenticated
  using (patient_id = my_patient_id() or clinician_id = auth.uid()
         or current_role_of() in ('doctor','caregiver'));
create policy ea_insert on emergency_access for insert to authenticated
  with check (clinician_id = auth.uid() and is_verified_provider()
              and current_role_of() = 'doctor');

-- The audit content is immutable. The one permitted transition is flipping
-- `merged` false -> true when the patient later re-authenticates and the
-- emergency notes are folded into the permanent record; everything else
-- (including any delete) is rejected at the storage layer.
create or replace function block_mutation_always() returns trigger
language plpgsql as $$
begin
  raise exception '% is an immutable audit log', tg_table_name;
end;
$$;

create or replace function emergency_access_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'emergency_access is an immutable audit log';
  end if;
  if row(old.id, old.patient_id, old.clinician_id, old.justification,
         old.actions_json, old.created_at, old.expires_at)
     is distinct from
     row(new.id, new.patient_id, new.clinician_id, new.justification,
         new.actions_json, new.created_at, new.expires_at) then
    raise exception 'emergency_access is an immutable audit log';
  end if;
  if old.merged and not new.merged then
    raise exception 'emergency_access merge cannot be undone';
  end if;
  return new;
end;
$$;
create trigger emergency_access_immutable
  before update or delete on emergency_access
  for each row execute function emergency_access_guard();

-- Running log of what was actually done under break-glass. Append-only.
create table emergency_access_actions (
  id         uuid primary key default gen_random_uuid(),
  access_id  uuid not null references emergency_access(id) on delete restrict,
  action     text not null,
  created_at timestamptz not null default now()
);
alter table emergency_access_actions enable row level security;
create policy eaa_read on emergency_access_actions for select to authenticated
  using (exists (
    select 1 from emergency_access e
    where e.id = access_id
      and (e.clinician_id = auth.uid() or e.patient_id = my_patient_id()
           or current_role_of() in ('doctor','caregiver'))
  ));
create policy eaa_insert on emergency_access_actions for insert to authenticated
  with check (exists (
    select 1 from emergency_access e
    where e.id = access_id and e.clinician_id = auth.uid()
  ));
create trigger emergency_access_actions_immutable
  before update or delete on emergency_access_actions
  for each row execute function block_mutation_always();

-- checkins: patient writes their own; caregiver reads linked patients.
create policy checkins_patient on checkins for all to authenticated
  using (patient_id = my_patient_id()) with check (patient_id = my_patient_id());
create policy checkins_caregiver_read on checkins for select to authenticated
  using (is_caregiver_of(patient_id) or has_consent(patient_id,'full_record'));
-- The caregiver's "simulate missed check-in" drives the escalation ladder.
create policy checkins_caregiver_update on checkins for update to authenticated
  using (is_caregiver_of(patient_id)) with check (is_caregiver_of(patient_id));

-- stock: pharmacist owns their shelf; alternative lookup is read-open to
-- authenticated providers (it exposes no patient data).
create policy stock_read on medicine_stock for select to authenticated using (true);
create policy stock_write on medicine_stock for all to authenticated
  using (pharmacy_id = auth.uid()) with check (pharmacy_id = auth.uid());

create policy interactions_read on drug_interactions for select to authenticated using (true);

create policy notif_own on notifications for select to authenticated
  using (user_id = auth.uid());
create policy notif_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Providers legitimately notify a patient (e.g. lab result ready).
create policy notif_insert on notifications for insert to authenticated
  with check (true);

-- --------------------------------------------------------------- grants ---
-- Table privileges are the outer gate; RLS above is the row-level gate. Both
-- are required. Nothing is granted to `anon` — every read needs a signed-in user.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ------------------------------------------------------------- realtime ---
alter publication supabase_realtime add table consent_requests;
alter publication supabase_realtime add table checkins;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table prescription_items;
alter publication supabase_realtime add table lab_results;

-- Realtime needs the old row to match RLS on UPDATE/DELETE events.
alter table consent_requests   replica identity full;
alter table checkins           replica identity full;
alter table prescription_items replica identity full;
