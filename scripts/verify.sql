-- ============================================================================
-- Health Stack — RLS + rules verification.
-- Run: npm run verify   (docker exec psql inside the local Supabase db)
--
-- Each block impersonates a real signed-in user by setting the same JWT claims
-- PostgREST sets, so these assertions exercise the exact policies the app hits.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off

create or replace function as_user(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role','authenticated')::text, true);
end;
$$;

create or replace function expect(p_label text, p_actual anyelement, p_expected anyelement)
returns void language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then
    raise notice 'PASS  %  (= %)', p_label, p_actual;
  else
    raise exception 'FAIL  %  expected %, got %', p_label, p_expected, p_actual;
  end if;
end;
$$;

\echo ''
\echo '--- seed sanity -------------------------------------------------------'
begin;
  select expect('patients seeded',        (select count(*)::int from patients), 3);
  select expect('anita has 2 allergies',  (select count(*)::int from allergies
                                           where patient_id='bbbbbbbb-0000-0000-0000-000000000001'), 2);
  select expect('auth users seeded',      (select count(*)::int from auth.users), 8);
  select expect('every auth user has identity',
                (select count(*)::int from auth.users u
                 where not exists (select 1 from auth.identities i where i.user_id = u.id)), 0);
commit;

\echo ''
\echo '--- consent gate: no consent means no data ----------------------------'
begin;
  select as_user('11111111-1111-1111-1111-111111111111');  -- Dr. Meera Rao
  select expect('doctor sees 0 patients pre-consent',   (select count(*)::int from patients), 0);
  select expect('doctor sees 0 allergies pre-consent',  (select count(*)::int from allergies), 0);
  select expect('doctor sees 0 encounters pre-consent', (select count(*)::int from encounters), 0);
rollback;

\echo ''
\echo '--- patient always sees their own record ------------------------------'
begin;
  select as_user('aaaaaaaa-0000-0000-0000-000000000001');  -- Anita
  select expect('anita sees herself',      (select count(*)::int from patients), 1);
  select expect('anita sees her allergies',(select count(*)::int from allergies), 2);
  select expect('anita sees her visits',   (select count(*)::int from encounters), 2);
rollback;

\echo ''
\echo '--- doctor requests consent, patient approves, record unlocks ---------'
begin;
  select as_user('11111111-1111-1111-1111-111111111111');
  select request_consent('HS-ANITA1','full_record', null, 'Consultation', 30) as req \gset
  select expect('still locked while pending', (select count(*)::int from encounters), 0);

  -- Anita taps Allow.
  select as_user('aaaaaaaa-0000-0000-0000-000000000001');
  update consent_requests set status='approved', responded_at=now()
   where patient_id = my_patient_id() and status='pending';

  select as_user('11111111-1111-1111-1111-111111111111');
  select expect('doctor now sees the patient',   (select count(*)::int from patients), 1);
  select expect('doctor now sees allergies',     (select count(*)::int from allergies), 2);
  select expect('doctor now sees 2 encounters',  (select count(*)::int from encounters), 2);
  select expect('doctor sees only this patient', (select count(distinct patient_id)::int from encounters), 1);
rollback;

\echo ''
\echo '--- consent is time-boxed: an expired grant discloses nothing ---------'
begin;
  select as_user('11111111-1111-1111-1111-111111111111');
  select request_consent('HS-ANITA1','full_record', null, 'Consultation', 30);
  select as_user('aaaaaaaa-0000-0000-0000-000000000001');
  update consent_requests set status='approved' where patient_id = my_patient_id() and status='pending';

  -- Wind the clock past the window.
  set local role postgres;
  update consent_requests set expires_at = now() - interval '1 minute'
   where patient_id='bbbbbbbb-0000-0000-0000-000000000001' and status='approved';

  select as_user('11111111-1111-1111-1111-111111111111');
  select expect('expired consent sees 0 encounters', (select count(*)::int from encounters), 0);
  select expect('expired consent sees 0 allergies',  (select count(*)::int from allergies), 0);
rollback;

\echo ''
\echo '--- role scoping: pharmacist gets the prescription, not the history ---'
begin;
  select as_user('22222222-2222-2222-2222-222222222222');  -- pharmacist
  select request_consent('HS-ANITA1','prescription', null, 'Dispensing', 30);
  select as_user('aaaaaaaa-0000-0000-0000-000000000001');
  update consent_requests set status='approved' where patient_id = my_patient_id() and status='pending';

  select as_user('22222222-2222-2222-2222-222222222222');
  select expect('pharmacist sees the prescription', (select count(*)::int from prescriptions), 1);
  select expect('pharmacist sees rx items',         (select count(*)::int from prescription_items), 1);
  select expect('pharmacist sees NO diagnoses',     (select count(*)::int from encounters), 0);
  select expect('pharmacist sees NO allergies',     (select count(*)::int from allergies), 0);
  select expect('pharmacist sees NO medications',   (select count(*)::int from medications), 0);
  select expect('pharmacist sees NO lab orders',    (select count(*)::int from lab_orders), 0);
rollback;

\echo ''
\echo '--- role scoping: a pharmacist cannot ask for the full record ---------'
begin;
  select as_user('22222222-2222-2222-2222-222222222222');
  do $$
  begin
    perform request_consent('HS-ANITA1','full_record', null, 'nice try', 30);
    raise exception 'FAIL  pharmacist was allowed to request full_record';
  exception when others then
    if position('not available to role' in sqlerrm) > 0 then
      raise notice 'PASS  pharmacist blocked from full_record scope';
    else raise; end if;
  end $$;
rollback;

\echo ''
\echo '--- role scoping: lab sees exactly one ordered test -------------------'
begin;
  -- Give Anita a second outstanding order so "only one" is a real assertion.
  set local role postgres;
  insert into lab_orders (patient_id, ordered_by, test_type, body_part)
  values ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
          'Chest X-Ray','Chest');

  select as_user('33333333-3333-3333-3333-333333333333');  -- lab
  select request_consent('HS-ANITA1','lab_order',
                         'eeeeeeee-0000-0000-0000-000000000001','Sample collection', 30);
  select as_user('aaaaaaaa-0000-0000-0000-000000000001');
  update consent_requests set status='approved' where patient_id = my_patient_id() and status='pending';

  select as_user('33333333-3333-3333-3333-333333333333');
  select expect('lab sees exactly 1 order', (select count(*)::int from lab_orders), 1);
  select expect('lab sees the RIGHT order',
                (select test_type from lab_orders), 'INR / Prothrombin Time');
  select expect('lab sees NO prescriptions', (select count(*)::int from prescriptions), 0);
  select expect('lab sees NO encounters',    (select count(*)::int from encounters), 0);
  select expect('lab sees NO allergies',     (select count(*)::int from allergies), 0);
rollback;

\echo ''
\echo '--- safety check: penicillin allergy + warfarin interaction -----------'
begin;
  select as_user('11111111-1111-1111-1111-111111111111');
  select request_consent('HS-ANITA1','full_record', null, 'Consultation', 30);
  select as_user('aaaaaaaa-0000-0000-0000-000000000001');
  update consent_requests set status='approved' where patient_id = my_patient_id() and status='pending';
  select as_user('11111111-1111-1111-1111-111111111111');

  -- Amoxicillin is a penicillin-class drug -> must catch via drug_classes.
  select expect('amoxicillin flags the penicillin allergy',
    (select count(*)::int from jsonb_array_elements(
       safety_check('bbbbbbbb-0000-0000-0000-000000000001',
         '[{"medicine":"Amoxil 500","composition":"amoxicillin 500mg"}]'::jsonb)) f
     where f->>'type' = 'allergy'), 1);

  -- Azithromycin is safe for her allergy but interacts with active warfarin.
  select expect('azithromycin flags the warfarin interaction',
    (select count(*)::int from jsonb_array_elements(
       safety_check('bbbbbbbb-0000-0000-0000-000000000001',
         '[{"medicine":"Azithral 500","composition":"azithromycin 500mg"}]'::jsonb)) f
     where f->>'type' = 'interaction'), 1);

  -- Duplicate therapy: she is already on levothyroxine.
  select expect('levothyroxine flags duplicate therapy',
    (select count(*)::int from jsonb_array_elements(
       safety_check('bbbbbbbb-0000-0000-0000-000000000001',
         '[{"medicine":"Thyronorm 50mcg","composition":"levothyroxine 50mcg"}]'::jsonb)) f
     where f->>'type' = 'duplicate'), 1);

  -- A genuinely safe drug must produce no noise at all.
  select expect('paracetamol raises no flags',
    (select jsonb_array_length(
       safety_check('bbbbbbbb-0000-0000-0000-000000000001',
         '[{"medicine":"Dolo 650","composition":"paracetamol 650mg"}]'::jsonb))), 0);
rollback;

\echo ''
\echo '--- safety check cannot be run without consent ------------------------'
begin;
  select as_user('11111111-1111-1111-1111-111111111111');
  do $$
  begin
    perform safety_check('bbbbbbbb-0000-0000-0000-000000000001',
                         '[{"medicine":"X","composition":"amoxicillin 500mg"}]'::jsonb);
    raise exception 'FAIL  safety_check ran without consent';
  exception when others then
    if position('no active consent' in sqlerrm) > 0 then
      raise notice 'PASS  safety_check refuses without consent';
    else raise; end if;
  end $$;
rollback;

\echo ''
\echo '--- break-glass: verified only, audited, immutable --------------------'
begin;
  -- Unverified clinician is refused.
  select as_user('11111111-1111-1111-1111-111111111112');  -- Dr. Arjun Nair, unverified
  do $$
  begin
    perform start_emergency_access('HS-ANITA1','Unconscious after RTA, cannot consent');
    raise exception 'FAIL  unverified clinician opened emergency access';
  exception when others then
    if position('restricted to verified' in sqlerrm) > 0 then
      raise notice 'PASS  unverified clinician blocked from break-glass';
    else raise; end if;
  end $$;
rollback;

begin;
  select as_user('11111111-1111-1111-1111-111111111111');  -- verified
  select start_emergency_access('HS-ANITA1','Unconscious after RTA, cannot consent') as ea \gset
  select expect('audit row written',   (select count(*)::int from emergency_access), 1);
  select expect('emergency unlocks allergies', (select count(*)::int from allergies), 2);
  select expect('patient was notified',
                (select count(*)::int from notifications n
                 where n.kind='emergency_access'
                   and n.user_id='aaaaaaaa-0000-0000-0000-000000000001'), 1);

  -- Break-glass is deliberately narrower than full consent.
  select expect('emergency does NOT unlock lab orders', (select count(*)::int from lab_orders), 0);

  -- The audit trail must resist tampering, even by its own author.
  do $$
  declare v_id uuid;
  begin
    select id into v_id from emergency_access limit 1;
    begin
      update emergency_access set justification = 'rewritten' where id = v_id;
      raise exception 'FAIL  audit row was editable';
    exception when others then
      if position('immutable audit log' in sqlerrm) > 0 then
        raise notice 'PASS  audit justification is immutable';
      else raise; end if;
    end;
    begin
      delete from emergency_access where id = v_id;
      raise exception 'FAIL  audit row was deletable';
    exception when others then
      if position('immutable audit log' in sqlerrm) > 0 then
        raise notice 'PASS  audit row cannot be deleted';
      else raise; end if;
    end;
  end $$;
rollback;

\echo ''
\echo '--- caregiver sees check-in status, never the medical record ----------'
begin;
  select as_user('44444444-4444-4444-4444-444444444444');  -- Priya
  select expect('caregiver sees 1 linked patient', (select count(*)::int from patients), 1);
  select expect('caregiver sees the check-in',     (select count(*)::int from checkins), 1);
  select expect('caregiver sees NO encounters',    (select count(*)::int from encounters), 0);
  select expect('caregiver sees NO prescriptions', (select count(*)::int from prescriptions), 0);
  select expect('caregiver sees NO lab orders',    (select count(*)::int from lab_orders), 0);
rollback;

\echo ''
\echo '--- an unrelated patient is invisible to everyone ---------------------'
begin;
  select as_user('aaaaaaaa-0000-0000-0000-000000000003');  -- Fatima
  select expect('fatima sees only herself', (select count(*)::int from patients), 1);
  select expect('fatima sees no one else''s visits', (select count(*)::int from encounters), 0);
rollback;

\echo ''
\echo '--- pharmacy stock supports the alternative-suggestion path -----------'
begin;
  select as_user('22222222-2222-2222-2222-222222222222');
  select expect('prescribed brand Azithral is out of stock',
                (select quantity from medicine_stock where medicine_name='Azithral 500'), 0);
  select expect('same composition available under another brand',
                (select count(*)::int from medicine_stock
                 where composition='azithromycin 500mg' and quantity > 0), 1);
rollback;

\echo ''
\echo '======================================================================'
\echo ' ALL CHECKS PASSED'
\echo '======================================================================'

drop function as_user(uuid);
drop function expect(text, anyelement, anyelement);
