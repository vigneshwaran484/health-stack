import { usePatientRecord } from '../../lib/record'
import { ConsentGate } from '../../components/ConsentGate'
import { ConsentBanner, PageHead } from '../../components/Shell'
import { RecordView } from '../../components/RecordView'
import { AiSummary } from './AiSummary'
import { PrescriptionComposer } from './PrescriptionComposer'
import { Spinner, Toast, useToast, Badge } from '../../components/ui'

export default function DoctorConsult({ consent }) {
  const toast = useToast()
  const { session, approved } = consent
  const { record, loading, reload } = usePatientRecord(session?.patientId, { enabled: approved })

  return (
    <>
      <ConsentGate
        role="doctor"
        consent={consent}
        extra={{ purpose: 'Consultation' }}
      >
        <ConsentBanner session={session} tick={consent.tick} onRevoke={consent.revoke} />

        <PageHead
          title={record?.patient?.user?.name ?? session?.patientName}
          subtitle={
            record?.patient
              ? `${record.patient.age ?? '—'} yrs · ${record.patient.blood_group ?? '—'} · ${session?.patientCode}`
              : session?.patientCode
          }
        >
          {record?.allergies?.length > 0 && (
            <Badge tone="bad">⚠ {record.allergies.length} recorded allergies</Badge>
          )}
        </PageHead>

        {loading ? (
          <div className="flex justify-center py-16 text-ink-500">
            <Spinner />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-start">
            <div className="space-y-5">
              <AiSummary record={record} />
              <RecordView record={record} />
            </div>
            <div className="lg:sticky lg:top-20">
              <PrescriptionComposer
                patientId={session.patientId}
                record={record}
                onSaved={(msg) => {
                  toast.success(msg)
                  reload()
                }}
              />
            </div>
          </div>
        )}
      </ConsentGate>
      <Toast toast={toast.toast} onClose={toast.clear} />
    </>
  )
}
