import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { explainSafetyFlag } from '../../lib/ai'
import { Badge, Button, Card, Field, Input, Spinner, inputClass } from '../../components/ui'

const EMPTY_ITEM = { medicine: '', composition: '', dosage: '', quantity: 10 }

/** Blocking warning: the doctor must acknowledge and justify before proceeding. */
function SafetyWarning({ flags, explanations, onCancel, onOverride, saving }) {
  const [reason, setReason] = useState('')
  const worst = flags.some((f) => f.severity === 'severe' || f.severity === 'major')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 p-5 backdrop-blur-sm">
      <Card className="slide-up w-full max-w-lg border-rose-500/40 bg-ink-900 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-xl">
            ⚠
          </div>
          <div>
            <h2 className="text-base font-bold text-white">
              {flags.length === 1 ? 'Prescribing conflict detected' : `${flags.length} prescribing conflicts detected`}
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Checked against this patient's recorded allergies and active medications.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {flags.map((flag, i) => (
            <div key={i} className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="bad">{flag.type}</Badge>
                <Badge tone={flag.severity === 'moderate' ? 'warn' : 'bad'}>{flag.severity}</Badge>
                <span className="text-sm font-semibold text-white">{flag.medicine}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-rose-100">{flag.message}</p>
              {explanations[i] && (
                <p className="mt-2 border-t border-rose-500/20 pt-2 text-xs leading-relaxed text-ink-300">
                  <span className="font-semibold text-mint-400">Why it matters: </span>
                  {explanations[i]}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5">
          <Field
            label="Override justification"
            hint="Required. Stored on the prescription and visible to the patient and pharmacist."
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. benefit outweighs risk, INR will be monitored twice weekly"
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Change the prescription
          </Button>
          <Button
            variant={worst ? 'danger' : 'warn'}
            onClick={() => onOverride(reason.trim())}
            disabled={saving || reason.trim().length < 5}
          >
            {saving ? <Spinner /> : 'Prescribe anyway'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

/**
 * Diagnosis + prescription + optional lab order.
 *
 * The safety check runs server-side (safety_check RPC) against the patient's
 * allergies, drug classes and active medications. The AI only turns each flag
 * into a sentence — pull the AI and the warning still fires.
 */
export function PrescriptionComposer({ patientId, record, onSaved }) {
  const [diagnosis, setDiagnosis] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])
  const [lab, setLab] = useState({ enabled: false, testType: '', bodyPart: '' })
  const [catalog, setCatalog] = useState([])
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flags, setFlags] = useState(null)
  const [explanations, setExplanations] = useState([])
  const [error, setError] = useState(null)

  // Brand -> composition mapping, so typing a brand fills the composition the
  // safety check actually reasons about.
  useEffect(() => {
    supabase
      .from('medicine_stock')
      .select('medicine_name, composition')
      .then(({ data }) => {
        const seen = new Map()
        for (const row of data ?? []) if (!seen.has(row.medicine_name)) seen.set(row.medicine_name, row.composition)
        setCatalog([...seen].map(([medicine_name, composition]) => ({ medicine_name, composition })))
      })
  }, [])

  const validItems = useMemo(
    () => items.filter((i) => i.medicine.trim() && i.composition.trim()),
    [items],
  )

  function updateItem(index, patch) {
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  function onMedicineChange(index, value) {
    const match = catalog.find((c) => c.medicine_name.toLowerCase() === value.trim().toLowerCase())
    updateItem(index, match ? { medicine: value, composition: match.composition } : { medicine: value })
  }

  async function runSafetyCheck() {
    setError(null)
    if (!diagnosis.trim()) return setError('Enter a diagnosis first.')
    if (validItems.length === 0) return setError('Add at least one medicine with its composition.')

    setChecking(true)
    const { data, error: rpcError } = await supabase.rpc('safety_check', {
      p_patient: patientId,
      p_items: validItems.map((i) => ({ medicine: i.medicine, composition: i.composition })),
    })
    setChecking(false)

    if (rpcError) return setError(rpcError.message)

    if (!data || data.length === 0) {
      await persist(null)
      return
    }

    setFlags(data)
    setExplanations(data.map(() => null))

    // Enrich each flag with a one-line explanation; the flag stands regardless.
    const context = {
      allergies: record.allergies.map((a) => a.substance),
      medications: record.medications.filter((m) => m.active).map((m) => m.name),
      age: record.patient?.age,
    }
    data.forEach(async (flag, i) => {
      const res = await explainSafetyFlag(flag, context)
      setExplanations((prev) => {
        const next = [...prev]
        next[i] = res.text
        return next
      })
    })
  }

  async function persist(overrideReason) {
    setSaving(true)
    setError(null)
    try {
      const { data: encounter, error: encErr } = await supabase
        .from('encounters')
        .insert({
          patient_id: patientId,
          doctor_id: (await supabase.auth.getUser()).data.user.id,
          diagnosis: diagnosis.trim(),
          notes: notes.trim() || null,
        })
        .select()
        .single()
      if (encErr) throw encErr

      const doctorId = encounter.doctor_id

      const { data: prescription, error: rxErr } = await supabase
        .from('prescriptions')
        .insert({ encounter_id: encounter.id, patient_id: patientId, doctor_id: doctorId })
        .select()
        .single()
      if (rxErr) throw rxErr

      const { error: itemsErr } = await supabase.from('prescription_items').insert(
        validItems.map((i) => ({
          prescription_id: prescription.id,
          medicine: i.medicine.trim(),
          composition: i.composition.trim().toLowerCase(),
          dosage: i.dosage.trim() || null,
          quantity: Number(i.quantity) || 1,
          override_reason: overrideReason || null,
        })),
      )
      if (itemsErr) throw itemsErr

      if (lab.enabled && lab.testType.trim()) {
        const { error: labErr } = await supabase.from('lab_orders').insert({
          encounter_id: encounter.id,
          patient_id: patientId,
          ordered_by: doctorId,
          test_type: lab.testType.trim(),
          body_part: lab.bodyPart.trim() || null,
        })
        if (labErr) throw labErr
      }

      // The patient owns the record, so the patient gets told.
      const { data: patientRow } = await supabase
        .from('patients')
        .select('user_id')
        .eq('id', patientId)
        .maybeSingle()
      if (patientRow?.user_id) {
        await supabase.from('notifications').insert({
          user_id: patientRow.user_id,
          kind: 'prescription',
          title: 'New prescription added',
          body: `${diagnosis.trim()} · ${validItems.length} item${validItems.length > 1 ? 's' : ''}`,
          data: { prescription_id: prescription.id },
        })
      }

      setFlags(null)
      setDiagnosis('')
      setNotes('')
      setItems([{ ...EMPTY_ITEM }])
      setLab({ enabled: false, testType: '', bodyPart: '' })
      onSaved(
        overrideReason
          ? 'Prescription saved with a documented override.'
          : 'Prescription saved — no conflicts found.',
      )
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <h3 className="text-sm font-bold text-white">New consultation</h3>
      <p className="mb-4 text-xs text-ink-500">
        Every prescription is checked against this patient's allergies and active medications before it saves.
      </p>

      <div className="space-y-4">
        <Field label="Diagnosis">
          <Input
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="e.g. Acute bacterial tonsillitis"
          />
        </Field>

        <Field label="Clinical notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputClass}
            placeholder="Examination findings, plan, follow-up"
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">Medicines</span>
            <button
              onClick={() => setItems((l) => [...l, { ...EMPTY_ITEM }])}
              className="text-xs font-semibold text-mint-400 hover:underline"
            >
              + Add medicine
            </button>
          </div>

          <datalist id="medicine-catalog">
            {catalog.map((c) => (
              <option key={c.medicine_name} value={c.medicine_name}>
                {c.composition}
              </option>
            ))}
          </datalist>

          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-ink-800 p-3 sm:grid-cols-[1.2fr_1.2fr_1fr_auto_auto]">
                <input
                  list="medicine-catalog"
                  value={item.medicine}
                  onChange={(e) => onMedicineChange(i, e.target.value)}
                  placeholder="Medicine / brand"
                  className={inputClass}
                />
                <input
                  value={item.composition}
                  onChange={(e) => updateItem(i, { composition: e.target.value })}
                  placeholder="Composition"
                  className={inputClass}
                />
                <input
                  value={item.dosage}
                  onChange={(e) => updateItem(i, { dosage: e.target.value })}
                  placeholder="1-0-1 after food"
                  className={inputClass}
                />
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                  className={`${inputClass} w-20`}
                />
                <button
                  onClick={() => setItems((l) => (l.length === 1 ? [{ ...EMPTY_ITEM }] : l.filter((_, j) => j !== i)))}
                  className="rounded-xl border border-ink-800 px-3 text-ink-500 hover:border-rose-500 hover:text-rose-300"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-ink-800 p-3">
          <input
            type="checkbox"
            checked={lab.enabled}
            onChange={(e) => setLab((l) => ({ ...l, enabled: e.target.checked }))}
            className="h-4 w-4 accent-[#14b89a]"
          />
          <span className="text-sm text-white">Also order a lab test / scan</span>
        </label>

        {lab.enabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Test type">
              <Input
                value={lab.testType}
                onChange={(e) => setLab((l) => ({ ...l, testType: e.target.value }))}
                placeholder="e.g. X-Ray, CBC, INR"
              />
            </Field>
            <Field label="Body part / sample" hint="The lab will see this and nothing else">
              <Input
                value={lab.bodyPart}
                onChange={(e) => setLab((l) => ({ ...l, bodyPart: e.target.value }))}
                placeholder="e.g. Chest, Blood"
              />
            </Field>
          </div>
        )}

        {error && <p className="text-sm text-rose-300">{error}</p>}

        <Button full onClick={runSafetyCheck} disabled={checking || saving}>
          {checking ? <Spinner /> : saving ? 'Saving…' : 'Run safety check & prescribe'}
        </Button>
      </div>

      {flags && (
        <SafetyWarning
          flags={flags}
          explanations={explanations}
          saving={saving}
          onCancel={() => setFlags(null)}
          onOverride={(reason) => persist(reason)}
        />
      )}
    </Card>
  )
}
