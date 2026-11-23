import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge, Button, Card, Spinner, StatusDot, useToast, Toast } from '../../components/ui'
import { clockTime } from '../../lib/format'
import { isBiometricAvailable, isEnrolled, enroll, verify } from '../../lib/webauthn'
import { ensurePermission, notify } from '../../lib/push'

const SYMPTOMS = [
  { key: 'none', label: 'None — I feel fine', tone: 'good' },
  { key: 'fever', label: 'Fever' },
  { key: 'chest_pain', label: 'Chest pain', urgent: true },
  { key: 'breathing', label: 'Difficulty breathing', urgent: true },
  { key: 'dizziness', label: 'Dizziness' },
  { key: 'weakness', label: 'Weakness' },
  { key: 'fall', label: 'I had a fall', urgent: true },
]

const SEVERITIES = ['mild', 'moderate', 'severe']

export default function PatientCheckIn({ patient }) {
  const toast = useToast()
  const [checkin, setCheckin] = useState(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState('prompt') // prompt | symptoms | verifying | done
  const [selected, setSelected] = useState([])
  const [severity, setSeverity] = useState('mild')
  const [bioAvailable, setBioAvailable] = useState(false)
  const [pushState, setPushState] = useState(Notification?.permission ?? 'default')

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('checkins')
      .select('*')
      .eq('patient_id', patient.id)
      .eq('date', today)
      .maybeSingle()
    setCheckin(data ?? null)
    if (data?.status === 'safe') setStep('done')
    setLoading(false)
  }, [patient.id])

  useEffect(() => {
    load()
    isBiometricAvailable().then(setBioAvailable)
  }, [load])

  // The caregiver's "simulate missed check-in" flips this row; the patient's
  // phone should react immediately, exactly as a real escalation would.
  useEffect(() => {
    const ch = supabase
      .channel(`checkin-patient-${patient.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checkins', filter: `patient_id=eq.${patient.id}` },
        (payload) => {
          const row = payload.new
          setCheckin(row)
          if (row?.status === 'reminder') {
            notify('Check-in reminder', 'Please confirm you are OK.', 'checkin-reminder')
            setStep('prompt')
          }
          if (row?.status === 'critical') {
            notify('URGENT: check in now', 'Your caregiver has been alerted.', 'checkin-critical')
            setStep('prompt')
          }
        },
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [patient.id])

  function toggle(key) {
    if (key === 'none') return setSelected(['none'])
    setSelected((s) => {
      const without = s.filter((k) => k !== 'none')
      return without.includes(key) ? without.filter((k) => k !== key) : [...without, key]
    })
  }

  async function enablePush() {
    const perm = await ensurePermission()
    setPushState(perm)
    if (perm === 'granted') {
      notify('Check-in reminders on', 'We will prompt you daily at 08:00.', 'checkin-setup')
      toast.success('Reminders enabled on this device')
    } else {
      toast.error('Notifications blocked — the in-app prompt still works')
    }
  }

  /** Proof of life: the biometric is what makes this a check-in and not a tap. */
  async function confirmWithBiometric() {
    setStep('verifying')
    try {
      let result = await verify()
      if (!result.verified && result.needsEnrolment) {
        await enroll({ patientCode: patient.patient_code, name: patient.patient_code })
        result = await verify()
      }
      if (!result.verified) {
        toast.error('Biometric check cancelled — check-in not recorded')
        setStep('symptoms')
        return
      }
      await save(result.method)
    } catch (err) {
      toast.error(err.message ?? 'Could not complete biometric confirmation')
      setStep('symptoms')
    }
  }

  async function save(method) {
    const today = new Date().toISOString().slice(0, 10)
    const symptoms = selected.length ? selected : ['none']
    const urgent = symptoms.some((s) => SYMPTOMS.find((x) => x.key === s)?.urgent)

    const payload = {
      patient_id: patient.id,
      date: today,
      status: 'safe',
      symptoms_json: symptoms,
      severity: symptoms[0] === 'none' ? null : severity,
      verified_at: new Date().toISOString(),
      verify_method: method,
      activity: `Checked in ${clockTime(new Date().toISOString())}`,
      escalated_at: null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('checkins').upsert(payload, { onConflict: 'patient_id,date' })
    if (error) {
      toast.error(error.message)
      setStep('symptoms')
      return
    }

    // A reported red-flag symptom is worth telling the caregiver about even
    // though the patient did check in.
    if (urgent) {
      const { data: links } = await supabase
        .from('caregiver_links')
        .select('caregiver_id')
        .eq('patient_id', patient.id)
      if (links?.length) {
        await supabase.from('notifications').insert(
          links.map((l) => ({
            user_id: l.caregiver_id,
            kind: 'checkin_symptom',
            title: 'Check-in reported a red-flag symptom',
            body: `${symptoms.filter((s) => s !== 'none').join(', ')} · severity ${severity}`,
            data: { patient_id: patient.id },
          })),
        )
      }
    }

    await load()
    setStep('done')
    toast.success('Check-in recorded — your caregiver can see you are safe')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-ink-500">
        <Spinner />
      </div>
    )
  }

  const status = checkin?.status ?? 'pending'

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StatusDot status={status} />
          <div>
            <div className="text-sm font-bold text-white">
              {status === 'safe'
                ? 'Checked in today'
                : status === 'critical'
                  ? 'Missed — caregiver alerted'
                  : status === 'reminder'
                    ? 'Reminder — please check in'
                    : 'Check-in due'}
            </div>
            <div className="text-[11px] text-ink-500">
              {checkin?.verified_at ? `Confirmed at ${clockTime(checkin.verified_at)}` : 'Not yet confirmed today'}
            </div>
          </div>
        </div>
        <Badge tone={status === 'safe' ? 'good' : status === 'critical' ? 'bad' : status === 'reminder' ? 'warn' : 'neutral'}>
          {status}
        </Badge>
      </Card>

      {pushState !== 'granted' && (
        <Card className="flex items-center justify-between gap-3 border-mint-500/30 bg-mint-500/5">
          <p className="text-xs text-ink-300">Turn on daily reminders for this device.</p>
          <Button variant="outline" onClick={enablePush}>
            Enable
          </Button>
        </Card>
      )}

      {step === 'done' && (
        <Card className="py-8 text-center">
          <div className="text-4xl">🟢</div>
          <h2 className="mt-3 text-base font-bold text-white">You're marked safe</h2>
          <p className="mt-1 text-xs text-ink-500">
            Confirmed with {checkin?.verify_method === 'biometric' ? 'your fingerprint / face' : 'device confirmation'}.
          </p>
          {checkin?.symptoms_json?.length > 0 && checkin.symptoms_json[0] !== 'none' && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {checkin.symptoms_json.map((s) => (
                <Badge key={s} tone="warn">
                  {SYMPTOMS.find((x) => x.key === s)?.label ?? s}
                </Badge>
              ))}
            </div>
          )}
          <Button variant="ghost" className="mt-5" onClick={() => setStep('symptoms')}>
            Update today's check-in
          </Button>
        </Card>
      )}

      {step === 'prompt' && (
        <Card className={`py-8 text-center ${status === 'critical' ? 'border-rose-500/40 bg-rose-500/5' : ''}`}>
          <div className="text-4xl">{status === 'critical' ? '🔴' : status === 'reminder' ? '🟡' : '👋'}</div>
          <h2 className="mt-3 text-base font-bold text-white">
            {status === 'critical' ? 'Please check in now' : 'Are you OK today?'}
          </h2>
          <p className="mx-auto mt-1 max-w-[16rem] text-xs text-ink-500">
            Takes 10 seconds. Your caregiver only sees that you're safe — not your medical record.
          </p>
          <Button className="mt-5" full onClick={() => setStep('symptoms')}>
            Start check-in
          </Button>
        </Card>
      )}

      {step === 'symptoms' && (
        <Card>
          <h2 className="text-sm font-bold text-white">How are you feeling?</h2>
          <p className="mb-3 mt-0.5 text-xs text-ink-500">Select everything that applies.</p>
          <div className="space-y-2">
            {SYMPTOMS.map((s) => {
              const on = selected.includes(s.key)
              return (
                <button
                  key={s.key}
                  onClick={() => toggle(s.key)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left text-sm transition ${
                    on
                      ? s.key === 'none'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                        : 'border-amber-500/50 bg-amber-500/10 text-amber-100'
                      : 'border-ink-800 text-ink-300 hover:border-ink-700'
                  }`}
                >
                  <span>{s.label}</span>
                  {s.urgent && <span className="text-[10px] font-bold uppercase text-rose-300">urgent</span>}
                </button>
              )
            })}
          </div>

          {selected.length > 0 && selected[0] !== 'none' && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">Severity</p>
              <div className="grid grid-cols-3 gap-2">
                {SEVERITIES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverity(s)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${
                      severity === s ? 'border-mint-500 bg-mint-500/10 text-mint-300' : 'border-ink-800 text-ink-500'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button full className="mt-5" disabled={selected.length === 0} onClick={confirmWithBiometric}>
            {bioAvailable ? 'Confirm with fingerprint / face' : 'Confirm on this device'}
          </Button>
          <p className="mt-2 text-center text-[11px] text-ink-500">
            {bioAvailable
              ? 'The biometric proves it is you, not just your phone.'
              : 'No biometric sensor here — the demo records a device confirmation instead.'}
          </p>
          {isEnrolled() && <p className="mt-1 text-center text-[10px] text-mint-400">Biometric enrolled on this device</p>}
        </Card>
      )}

      {step === 'verifying' && (
        <Card className="py-12 text-center">
          <Spinner className="h-6 w-6" />
          <p className="mt-3 text-sm text-ink-300">Waiting for biometric confirmation…</p>
        </Card>
      )}

      <Toast toast={toast.toast} onClose={toast.clear} />
    </div>
  )
}
