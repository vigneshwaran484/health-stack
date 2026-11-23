import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * Loads a patient's record. Used by both the patient's own history screen and
 * the doctor's consented view — identical query, different caller.
 *
 * There is no "am I allowed?" branch here on purpose: RLS decides. A caller
 * without consent gets empty arrays back from Postgres, not a client-side
 * blank-out. That is the difference between scoping and hiding.
 */
export function usePatientRecord(patientId, { enabled = true } = {}) {
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!patientId || !enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [patient, allergies, medications, encounters, prescriptions, labOrders, emergencies] =
        await Promise.all([
          supabase.from('patients').select('*, user:users(name, email)').eq('id', patientId).maybeSingle(),
          supabase.from('allergies').select('*').eq('patient_id', patientId).order('created_at'),
          supabase.from('medications').select('*').eq('patient_id', patientId).order('started_at', { ascending: false }),
          supabase.from('encounters').select('*, doctor:users(name, org)').eq('patient_id', patientId).order('created_at', { ascending: false }),
          supabase
            .from('prescriptions')
            .select('*, doctor:users(name, org), items:prescription_items(*)')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false }),
          supabase
            .from('lab_orders')
            .select('*, ordered_by_user:users(name, org), results:lab_results(*)')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false }),
          supabase
            .from('emergency_access')
            .select('*, clinician:users(name, org)')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false }),
        ])

      setRecord({
        patient: patient.data ?? null,
        allergies: allergies.data ?? [],
        medications: medications.data ?? [],
        encounters: encounters.data ?? [],
        prescriptions: prescriptions.data ?? [],
        labOrders: labOrders.data ?? [],
        emergencies: emergencies.data ?? [],
      })
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }, [patientId, enabled])

  useEffect(() => {
    load()
  }, [load])

  return { record, loading, error, reload: load }
}

/** Compact shape handed to the AI summariser — no identifiers leave the server. */
export function toSummaryPayload(record) {
  if (!record) return {}
  return {
    demographics: {
      age: record.patient?.age,
      blood_group: record.patient?.blood_group,
      weight_kg: record.patient?.weight,
      height_cm: record.patient?.height,
    },
    allergies: record.allergies.map((a) => `${a.substance} (${a.severity})`),
    active_medications: record.medications.filter((m) => m.active).map((m) => m.name),
    past_visits: record.encounters.slice(0, 8).map((e) => ({
      date: e.created_at?.slice(0, 10),
      diagnosis: e.diagnosis,
      notes: e.notes,
      emergency: e.emergency || undefined,
    })),
    prescriptions: record.prescriptions.slice(0, 6).map((p) => ({
      date: p.created_at?.slice(0, 10),
      items: p.items?.map((i) => `${i.medicine} ${i.dosage ?? ''}`.trim()),
    })),
    tests: record.labOrders.slice(0, 6).map((o) => ({
      test: o.test_type,
      body_part: o.body_part,
      status: o.status,
      result: o.results?.[0]?.result_json,
    })),
  }
}
