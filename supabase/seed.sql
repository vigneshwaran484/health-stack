-- ============================================================================
-- Health Stack — demo seed
-- Run by `npm run db:reset`. Every login below uses the password: demo1234
-- ============================================================================

-- Every demo login, created as a confirmed email/password auth user plus its
-- public.users profile. One self-contained block so it survives being sent as a
-- single batch by `supabase db reset`.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- id, email, role, name, verified, org
      ('11111111-1111-1111-1111-111111111111','doctor@demo.in','doctor','Dr. Meera Rao',
       true,'City Care Hospital'),
      -- Unverified on purpose: proves break-glass refuses an unverified clinician.
      ('11111111-1111-1111-1111-111111111112','doctor2@demo.in','doctor','Dr. Arjun Nair',
       false,'Sunrise Clinic'),
      ('22222222-2222-2222-2222-222222222222','pharmacist@demo.in','pharmacist','Sunil Kumar',
       true,'Apollo Pharmacy, Anna Nagar'),
      ('33333333-3333-3333-3333-333333333333','lab@demo.in','lab','Metro Diagnostics',
       true,'Metro Diagnostics, T. Nagar'),
      ('44444444-4444-4444-4444-444444444444','caregiver@demo.in','caregiver','Priya Iyer',
       false,null),
      ('aaaaaaaa-0000-0000-0000-000000000001','anita@demo.in','patient','Anita Sharma',
       false,null),
      ('aaaaaaaa-0000-0000-0000-000000000002','ramesh@demo.in','patient','Ramesh Iyer',
       false,null),
      ('aaaaaaaa-0000-0000-0000-000000000003','fatima@demo.in','patient','Fatima Khan',
       false,null)
    ) as t(id, email, role, name, verified, org)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id::uuid, 'authenticated', 'authenticated',
      r.email, crypt('demo1234', gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',array['email'],'role',r.role),
      jsonb_build_object('name',r.name,'role',r.role), now(), now()
    );

    -- GoTrue needs a matching identity row or email/password sign-in fails.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), r.id::uuid, r.id,
      jsonb_build_object('sub', r.id, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    );

    insert into users (id, role, name, email, verified, org)
    values (r.id::uuid, r.role::user_role, r.name, r.email, r.verified, r.org);
  end loop;
end $$;

-- Fixed codes/tokens so the demo script and printed QR stay stable.
insert into patients (id, user_id, patient_code, qr_token, age, blood_group, weight, height,
                      phone, emergency_contact, checkin_enrolled) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
   'HS-ANITA1','hs-qr-anita-2f7c91ab', 34, 'O+',  58, 162, '+91 98400 11111', 'Rohit Sharma +91 98400 11122', false),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002',
   'HS-RAM072','hs-qr-ramesh-84be03df', 72, 'B+', 66, 168, '+91 98400 22222', 'Priya Iyer +91 98400 22233', true),
  ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000003',
   'HS-FATH28','hs-qr-fatima-19dd57c4', 28, 'A+', 54, 158, '+91 98400 33333', 'Imran Khan +91 98400 33344', false);

-- Anita is the safety-check patient: penicillin allergy + active anticoagulant.
insert into allergies (patient_id, substance, severity) values
  ('bbbbbbbb-0000-0000-0000-000000000001','Penicillin','severe'),
  ('bbbbbbbb-0000-0000-0000-000000000001','Sulfa','moderate'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Aspirin','moderate');

insert into medications (patient_id, name, composition, active, started_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001','Warfarin 5mg','warfarin 5mg', true, current_date - 240),
  ('bbbbbbbb-0000-0000-0000-000000000001','Thyronorm 50mcg','levothyroxine 50mcg', true, current_date - 600),
  ('bbbbbbbb-0000-0000-0000-000000000002','Telmisartan 40mg','telmisartan 40mg', true, current_date - 900),
  ('bbbbbbbb-0000-0000-0000-000000000002','Metformin 500mg','metformin 500mg', true, current_date - 700);

insert into caregiver_links (caregiver_id, patient_id, relationship) values
  ('44444444-4444-4444-4444-444444444444','bbbbbbbb-0000-0000-0000-000000000002','Daughter');

-- ------------------------------------------------- history worth reading ---
insert into encounters (id, patient_id, doctor_id, diagnosis, notes, created_at) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111','Deep vein thrombosis, left calf',
   'Started on warfarin. INR target 2-3. Monthly INR checks. Patient counselled on bleeding risk.',
   now() - interval '240 days'),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111','Hypothyroidism, stable',
   'TSH 3.1. Continue levothyroxine 50mcg. Review in 6 months.',
   now() - interval '95 days'),
  ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111','Type 2 diabetes with hypertension',
   'HbA1c 7.4. BP 138/86. Continue metformin + telmisartan. Enrolled in daily check-in after a fall in March.',
   now() - interval '60 days');

insert into prescriptions (id, encounter_id, patient_id, doctor_id, created_at) values
  ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   now() - interval '95 days');
insert into prescription_items (prescription_id, medicine, composition, dosage, quantity, dispense_status) values
  ('dddddddd-0000-0000-0000-000000000001','Thyronorm 50mcg','levothyroxine 50mcg','1-0-0 before food',90,'dispensed');

-- An outstanding lab order so the lab flow is demoable on its own.
insert into lab_orders (id, encounter_id, patient_id, ordered_by, test_type, body_part, status, created_at) values
  ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'INR / Prothrombin Time','Blood','ordered', now() - interval '2 days');

-- Today's check-in for the at-risk patient, still pending.
insert into checkins (patient_id, date, status, activity, battery) values
  ('bbbbbbbb-0000-0000-0000-000000000002', current_date, 'pending', 'Phone unlocked 07:42', 78);

-- --------------------------------------------------- pharmacy shelf (partial)
-- Deliberately partial: the prescribed BRAND for azithromycin is absent but the
-- same COMPOSITION is stocked under another brand -> alternative path fires.
insert into medicine_stock (pharmacy_id, medicine_name, composition, quantity) values
  ('22222222-2222-2222-2222-222222222222','Dolo 650','paracetamol 650mg', 120),
  ('22222222-2222-2222-2222-222222222222','Crocin 650','paracetamol 650mg', 40),
  ('22222222-2222-2222-2222-222222222222','Azee 500','azithromycin 500mg', 24),
  ('22222222-2222-2222-2222-222222222222','Cetzine 10','cetirizine 10mg', 60),
  ('22222222-2222-2222-2222-222222222222','Amoxil 500','amoxicillin 500mg', 30),
  ('22222222-2222-2222-2222-222222222222','Pan 40','pantoprazole 40mg', 55),
  ('22222222-2222-2222-2222-222222222222','Thyronorm 50mcg','levothyroxine 50mcg', 90),
  ('22222222-2222-2222-2222-222222222222','Azithral 500','azithromycin 500mg', 0);  -- shelf-empty

-- ------------------------------------------------------- clinical rules -----
insert into drug_classes (composition, class_name) values
  ('amoxicillin','Penicillin'), ('ampicillin','Penicillin'), ('cloxacillin','Penicillin'),
  ('piperacillin','Penicillin'), ('benzylpenicillin','Penicillin'), ('co-amoxiclav','Penicillin'),
  ('sulfamethoxazole','Sulfa'), ('cotrimoxazole','Sulfa'),
  ('ibuprofen','NSAID'), ('diclofenac','NSAID'), ('naproxen','NSAID'), ('aspirin','NSAID');

insert into drug_interactions (composition_a, composition_b, severity, note) values
  ('warfarin','ibuprofen','major','NSAIDs raise bleeding risk on warfarin'),
  ('warfarin','aspirin','major','additive antiplatelet effect increases bleeding risk'),
  ('warfarin','azithromycin','major','macrolides potentiate warfarin — INR can spike'),
  ('warfarin','diclofenac','major','NSAIDs raise bleeding risk on warfarin'),
  ('levothyroxine','pantoprazole','moderate','PPIs reduce levothyroxine absorption'),
  ('metformin','contrast iodine','major','hold metformin around iodinated contrast'),
  ('telmisartan','ibuprofen','moderate','NSAIDs blunt antihypertensive effect and stress renal function');

