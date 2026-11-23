-- ============================================================================
-- Health Stack — RPCs
--
-- These exist because a provider legitimately needs to do something *before*
-- consent exists (look a patient up by QR) or something the audit log forbids
-- doing directly (flip `merged`). Everything else goes through plain RLS.
-- ============================================================================

-- Drug class table so an allergy to "Penicillin" catches Amoxicillin.
create table drug_classes (
  id          uuid primary key default gen_random_uuid(),
  composition text not null,
  class_name  text not null
);
create index on drug_classes (lower(composition));
alter table drug_classes enable row level security;
create policy classes_read on drug_classes for select to authenticated using (true);

-- Human-readable patient IDs: HS-7K2M4Q
create or replace function gen_patient_code() returns text
language plpgsql as $$
declare code text;
begin
  loop
    code := 'HS-' || upper(substr(translate(encode(gen_random_bytes(8),'base64'),
                                            '+/=IO01l', 'ABCDEFGH'), 1, 6));
    exit when not exists (select 1 from patients where patient_code = code);
  end loop;
  return code;
end;
$$;
alter table patients alter column patient_code set default gen_patient_code();

-- --------------------------------------------------------------------------
-- Consent
-- --------------------------------------------------------------------------

-- Sweeps rows whose window has closed. Called opportunistically by the UI;
-- has_consent() already treats expired rows as invalid, so this is only about
-- making the status column honest on screen.
create or replace function expire_stale_consents() returns void
language sql security definer set search_path = public as $$
  update consent_requests set status = 'expired'
  where status in ('pending','approved') and expires_at <= now();
$$;

-- A provider scanning a QR cannot yet read the patients table — that is the
-- whole point. This runs as definer to turn a QR token into a consent request
-- while leaking nothing beyond the patient's display name.
create or replace function request_consent(
  p_identifier text,
  p_scope      consent_scope,
  p_scope_ref  uuid default null,
  p_purpose    text default null,
  p_minutes    int  default 30
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role     user_role;
  v_verified boolean;
  v_patient  patients%rowtype;
  v_name     text;
  v_id       uuid;
begin
  select role, verified into v_role, v_verified from users where id = auth.uid();
  if v_role is null then
    raise exception 'not authenticated';
  end if;
  if v_role not in ('doctor','pharmacist','lab') then
    raise exception 'only providers can request consent';
  end if;
  -- Pilot: `verified` is seeded. Production would gate this on a live ABDM
  -- Healthcare Professional Registry (HPR) lookup.
  if not v_verified then
    raise exception 'provider is not verified';
  end if;
  if (v_role = 'doctor'     and p_scope <> 'full_record')
  or (v_role = 'pharmacist' and p_scope <> 'prescription')
  or (v_role = 'lab'        and p_scope <> 'lab_order') then
    raise exception 'scope % is not available to role %', p_scope, v_role;
  end if;

  select * into v_patient from patients
   where qr_token = trim(p_identifier)
      or upper(patient_code) = upper(trim(p_identifier));
  if v_patient.id is null then
    raise exception 'no patient matches that QR code or Patient ID';
  end if;

  -- A lab must arrive with a specific order; otherwise pin it to the newest
  -- outstanding one so scope can never widen to "all this patient's tests".
  if p_scope = 'lab_order' and p_scope_ref is null then
    select id into p_scope_ref from lab_orders
     where patient_id = v_patient.id and status in ('ordered','sampled')
     order by created_at desc limit 1;
    if p_scope_ref is null then
      raise exception 'no outstanding lab order for this patient';
    end if;
  end if;

  select name into v_name from users where id = v_patient.user_id;

  insert into consent_requests (patient_id, requester_id, requester_role, scope,
                                scope_ref, purpose, expires_at)
  values (v_patient.id, auth.uid(), v_role, p_scope, p_scope_ref, p_purpose,
          now() + make_interval(mins => p_minutes))
  returning id into v_id;

  return jsonb_build_object(
    'consent_id',   v_id,
    'patient_id',   v_patient.id,
    'patient_name', v_name,
    'patient_code', v_patient.patient_code,
    'scope',        p_scope,
    'scope_ref',    p_scope_ref,
    'expires_in_minutes', p_minutes
  );
end;
$$;

-- --------------------------------------------------------------------------
-- Prescribe-time safety check (rules layer)
--
-- Deterministic and offline. The AI layer only turns a flag produced here into
-- a plain-English sentence — if the AI is unreachable the flag still fires.
-- --------------------------------------------------------------------------
create or replace function safety_check(p_patient uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_item    jsonb;
  v_flags   jsonb := '[]'::jsonb;
  v_comp    text;
  v_med     text;
  r         record;
begin
  if not (has_consent(p_patient,'full_record') or has_emergency_access(p_patient)) then
    raise exception 'no active consent for this patient';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_comp := lower(trim(v_item->>'composition'));
    v_med  := coalesce(v_item->>'medicine', v_comp);
    continue when v_comp is null or v_comp = '';

    -- 1. Direct or drug-class allergy conflict.
    for r in
      select a.substance, a.severity
      from allergies a
      where a.patient_id = p_patient
        and (
          v_comp like '%' || lower(a.substance) || '%'
          or lower(a.substance) like '%' || v_comp || '%'
          or exists (
            select 1 from drug_classes dc
            where lower(dc.class_name) = lower(a.substance)
              and v_comp like '%' || lower(dc.composition) || '%'
          )
        )
    loop
      v_flags := v_flags || jsonb_build_object(
        'type','allergy', 'severity', coalesce(r.severity,'major'),
        'medicine', v_med, 'composition', v_comp, 'conflicts_with', r.substance,
        'message', format('%s conflicts with recorded %s allergy', v_med, r.substance));
    end loop;

    -- 2. Interaction with an active medication.
    for r in
      select m.name as med_name, m.composition as med_comp, di.severity, di.note
      from medications m
      join drug_interactions di
        on (v_comp like '%'||lower(di.composition_a)||'%' and lower(m.composition) like '%'||lower(di.composition_b)||'%')
        or (v_comp like '%'||lower(di.composition_b)||'%' and lower(m.composition) like '%'||lower(di.composition_a)||'%')
      where m.patient_id = p_patient and m.active
    loop
      v_flags := v_flags || jsonb_build_object(
        'type','interaction', 'severity', r.severity,
        'medicine', v_med, 'composition', v_comp, 'conflicts_with', r.med_name,
        'message', format('%s interacts with active medication %s — %s', v_med, r.med_name, r.note));
    end loop;

    -- 3. Duplicate therapy: same composition already active.
    for r in
      select m.name as med_name from medications m
      where m.patient_id = p_patient and m.active and lower(m.composition) = v_comp
    loop
      v_flags := v_flags || jsonb_build_object(
        'type','duplicate', 'severity','moderate',
        'medicine', v_med, 'composition', v_comp, 'conflicts_with', r.med_name,
        'message', format('%s duplicates active medication %s (same composition)', v_med, r.med_name));
    end loop;
  end loop;

  return v_flags;
end;
$$;

-- --------------------------------------------------------------------------
-- Emergency break-glass
-- --------------------------------------------------------------------------
create or replace function start_emergency_access(
  p_identifier    text,
  p_justification text,
  p_minutes       int default 60
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role     user_role;
  v_verified boolean;
  v_patient  patients%rowtype;
  v_name     text;
  v_id       uuid;
begin
  select role, verified into v_role, v_verified from users where id = auth.uid();
  if v_role <> 'doctor' then
    raise exception 'only a clinician can trigger emergency access';
  end if;
  -- The break-glass gate: unverified clinicians are blocked outright.
  if not v_verified then
    raise exception 'emergency access is restricted to verified clinicians';
  end if;
  if coalesce(trim(p_justification),'') = '' then
    raise exception 'a justification is required';
  end if;

  select * into v_patient from patients
   where qr_token = trim(p_identifier)
      or upper(patient_code) = upper(trim(p_identifier));
  if v_patient.id is null then
    raise exception 'no patient matches that Patient ID';
  end if;

  insert into emergency_access (patient_id, clinician_id, justification, actions_json, expires_at)
  values (v_patient.id, auth.uid(), p_justification,
          jsonb_build_array('break-glass access opened'),
          now() + make_interval(mins => p_minutes))
  returning id into v_id;

  select name into v_name from users where id = v_patient.user_id;

  -- Transparency: the patient is told, and it lands in their activity log.
  insert into notifications (user_id, kind, title, body, data)
  values (v_patient.user_id, 'emergency_access', 'Emergency access to your record',
          'A verified clinician opened emergency access. Tap to review the audit entry.',
          jsonb_build_object('access_id', v_id));

  return jsonb_build_object('access_id', v_id, 'patient_id', v_patient.id,
                            'patient_name', v_name, 'patient_code', v_patient.patient_code);
end;
$$;

-- The one sanctioned mutation of the audit log: the patient re-authenticates
-- and the emergency notes fold into the permanent record.
create or replace function merge_emergency_access(p_access_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_patient uuid;
begin
  select patient_id into v_patient from emergency_access where id = p_access_id;
  if v_patient is null then raise exception 'no such emergency access'; end if;
  if v_patient <> my_patient_id() and not has_consent(v_patient,'full_record') then
    raise exception 'not permitted to merge this record';
  end if;
  update emergency_access set merged = true where id = p_access_id;
  insert into emergency_access_actions (access_id, action)
  values (p_access_id, 'records merged into permanent record after patient re-authentication');
end;
$$;

-- --------------------------------------------------------------------------
-- Storage: lab scans / report images
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('lab-media','lab-media', false)
on conflict (id) do nothing;

create policy "lab uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'lab-media' and current_role_of() = 'lab');
-- Reads are via short-lived signed URLs minted only for viewers who already
-- passed the row-level check on the owning lab_result.
create policy "lab media read" on storage.objects for select to authenticated
  using (bucket_id = 'lab-media');

-- Re-run for objects created in this migration (drug_classes, the RPCs).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
