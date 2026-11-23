import { usePatientRecord } from '../../lib/record'
import { RecordView } from '../../components/RecordView'
import { Spinner } from '../../components/ui'

export default function PatientHistory({ patientId }) {
  const { record, loading } = usePatientRecord(patientId)

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-ink-500">
        <Spinner />
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-4 text-base font-bold text-white">Your record</h2>
      <RecordView record={record} dense />
    </div>
  )
}
