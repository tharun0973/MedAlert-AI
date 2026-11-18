import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Activity, AlertCircle, AlertTriangle, CalendarDays, Check, Pencil, Trash2,
  CheckCircle2, Clock, Heart, Home, LogOut, Menu, Pill,
  RefreshCw, ShieldAlert, UserRound, Users, X, UserPlus,
} from 'lucide-react'
import { api, errorMessage, errorStatus } from './api'
import './App.css'

type Page = 'overview' | 'medications' | 'appointments' | 'checkins' | 'emergency' | 'caregivers'

// The backend intentionally returns endpoint-specific DTOs; components narrow fields at their use sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

type Account = {
  account_id: number
  email: string
  role: 'senior' | 'caregiver'
  patient_id?: number | null
  caregiver_id?: number | null
}

const navigation = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'medications', label: 'Medications', icon: Pill },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays },
  { id: 'checkins', label: 'Wellness', icon: Heart },
  { id: 'emergency', label: 'Emergency', icon: ShieldAlert },
  { id: 'caregivers', label: 'Care team', icon: Users },
] as const

const pageDescriptions: Record<Page, string> = {
  overview: 'Your care and medication overview',
  medications: 'Review medication schedules and doses',
  appointments: 'Keep upcoming care visits in view',
  checkins: 'Track wellness check-ins',
  emergency: 'Manage emergency information and alerts',
  caregivers: 'Coordinate your care team',
}

const permissionLabels = {
  can_view_medications: 'Medication schedule',
  can_view_appointments: 'Appointments',
  can_view_wellness: 'Wellness check-ins',
  can_view_emergency: 'Emergency contacts',
  can_view_medical_profile: 'Medical profile',
  can_receive_alerts: 'Receive caregiver alerts',
} as const
type PermissionKey = keyof typeof permissionLabels

// Handles list, wrapped-list, and single-record responses from the established API surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows(data: any): Row[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.results)) return data.results
  return data && typeof data === 'object' ? [data] : []
}

function idOf(item: Row): number {
  return Number(item.id ?? item.patient_id ?? item.schedule_id ?? item.dose_id ?? item.medication_id ?? item.alert_id ?? item.contact_id ?? 0)
}

function dateLabel(value?: string): string {
  if (!value) return 'Date not available'
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = dateMatch
    ? new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
    : new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeLabel(value?: string): string {
  if (!value) return 'Time not set'
  if (value.includes('T')) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  const parts = value.split(':')
  if (parts.length < 2) return value
  const date = new Date()
  date.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const refreshInProgress = useRef(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [registerMode, setRegisterMode] = useState(false)
  const [caregiverRegisterMode, setCaregiverRegisterMode] = useState(false)
  const [invitationCode, setInvitationCode] = useState('')

  const [patient, setPatient] = useState<Row | null>(null)
  const [medications, setMedications] = useState<Row[]>([])
  const [medicationPhotos, setMedicationPhotos] = useState<Record<number, string>>({})
  const [schedules, setSchedules] = useState<Row[]>([])

  const [medName, setMedName] = useState('')
  const [medDosage, setMedDosage] = useState('')
  const [medFrequency, setMedFrequency] = useState('Once daily')
  const [medTimes, setMedTimes] = useState('09:00')
  const [medFoodInstructions, setMedFoodInstructions] = useState('')
  const [medCritical, setMedCritical] = useState(false)
  const [medGracePeriod, setMedGracePeriod] = useState('30')
  const [medPhoto, setMedPhoto] = useState<File | null>(null)
  const [editingMedicationId, setEditingMedicationId] = useState<number | null>(null)
  const [editingContactId, setEditingContactId] = useState<number | null>(null)
  const [editingMedicalProfile, setEditingMedicalProfile] = useState(false)

  const [appointmentTitle, setAppointmentTitle] = useState('')
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null)
  const [appointmentType, setAppointmentType] = useState('appointment')
  const [appointmentDate, setAppointmentDate] = useState('')
  const [appointmentTime, setAppointmentTime] = useState('')
  const [appointmentLocation, setAppointmentLocation] = useState('')
  const [appointmentNotes, setAppointmentNotes] = useState('')

  const [doses, setDoses] = useState<Row[]>([])
  const [appointments, setAppointments] = useState<Row[]>([])
  const [checkins, setCheckins] = useState<Row[]>([])
  const [contacts, setContacts] = useState<Row[]>([])
  const [emergencyAlerts, setEmergencyAlerts] = useState<Row[]>([])
  const [emergencyAlertsError, setEmergencyAlertsError] = useState('')
  const [auditLogs, setAuditLogs] = useState<Row[]>([])
  const [medicalProfile, setMedicalProfile] = useState<Row | null>(null)
  const [contactsError, setContactsError] = useState('')
  const [medicalProfileError, setMedicalProfileError] = useState('')

  const [contactName, setContactName] = useState('')
  const [contactRelationship, setContactRelationship] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPrimary, setContactPrimary] = useState(false)
  const [contactReceivesAlerts, setContactReceivesAlerts] = useState(true)
  const [medicalForm, setMedicalForm] = useState<Row>({})

  useEffect(() => {
    setMedicalForm(medicalProfile ? {
      blood_group: medicalProfile.blood_group ?? '',
      allergies: medicalProfile.allergies ?? '',
      medical_conditions: medicalProfile.medical_conditions ?? '',
      physician_name: medicalProfile.physician_name ?? '',
      physician_phone: medicalProfile.physician_phone ?? '',
      physician_address: medicalProfile.physician_address ?? '',
      insurance_provider: medicalProfile.insurance_provider ?? '',
      insurance_policy_number: medicalProfile.insurance_policy_number ?? '',
      insurance_member_id: medicalProfile.insurance_member_id ?? '',
    } : {})
  }, [medicalProfile])

  const [alerts, setAlerts] = useState<Row[]>([])
  const [caregivers, setCaregivers] = useState<Row[]>([])
  const [caregiverName, setCaregiverName] = useState('')
  const [caregiverEmail, setCaregiverEmail] = useState('')
  const [caregiverPhone, setCaregiverPhone] = useState('')
  const [caregiverRelationship, setCaregiverRelationship] = useState('')
  const [issuedInvitationCode, setIssuedInvitationCode] = useState('')
  const [refillsByMedication, setRefillsByMedication] = useState<Record<number, Row[]>>({})
  const [refillDates, setRefillDates] = useState<Record<number, string>>({})
  const [refillPharmacies, setRefillPharmacies] = useState<Record<number, string>>({})
  const [resourceErrors, setResourceErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    const urls: string[] = []
    const token = sessionStorage.getItem('medalert_token')
    Promise.all(medications.filter((item) => item.photo_path).map(async (item) => {
      try {
        const response = await fetch(`/api/medications/${idOf(item)}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!response.ok) throw new Error('Photo unavailable')
        const url = URL.createObjectURL(await response.blob()); urls.push(url)
        return [idOf(item), url] as const
      } catch { return [idOf(item), ''] as const }
    })).then((entries) => { if (active) setMedicationPhotos(Object.fromEntries(entries)) })
    return () => { active = false; urls.forEach(URL.revokeObjectURL) }
  }, [medications])

  const patientId = Number(account?.patient_id ?? patient?.id ?? patient?.patient_id ?? 0)

  const logout = useCallback(() => {
    sessionStorage.removeItem('medalert_token')
    sessionStorage.removeItem('medalert_role')
    setAccount(null)
    setPatient(null)
    setMedications([])
    setSchedules([])
    setDoses([])
    setAppointments([])
    setCheckins([])
    setContacts([])
    setEmergencyAlerts([])
    setEmergencyAlertsError('')
    setAuditLogs([])
    setMedicalProfile(null)
    setContactsError('')
    setMedicalProfileError('')
    setAlerts([])
    setCaregivers([])
    setIssuedInvitationCode('')
    setRefillsByMedication({})
    setResourceErrors({})
    setPage('overview')
    setError('')
    setNotice('')
  }, [])

  const loadDashboard = useCallback(async (currentAccount: Account) => {
    setError('')
    setLoading(true)

    try {
      const patientResponse = await api.get('/patients')
      const patientRows = rows(patientResponse.data)
      const currentPatient =
        patientRows.find((item) => Number(item.id ?? item.patient_id) === Number(currentAccount.patient_id)) ??
        patientRows[0] ??
        null

      setPatient(currentPatient)

      const resolvedPatientId = Number(
        currentAccount.patient_id ??
        currentPatient?.id ??
        currentPatient?.patient_id ??
        0,
      )

      if (resolvedPatientId) {
        const results = await Promise.allSettled([
          api.get(`/patients/${resolvedPatientId}/medications`),
          api.get(`/patients/${resolvedPatientId}/appointments`),
          api.get(`/patients/${resolvedPatientId}/wellness-checkins`),
          api.get(`/patients/${resolvedPatientId}/emergency-contacts`),
          api.get(`/patients/${resolvedPatientId}/medical-profile`),
          currentAccount.role === 'senior' ? api.get(`/patients/${resolvedPatientId}/caregivers`) : Promise.resolve({ data: [] as Row[] }),
          api.get('/medication-doses?status=all'),
          api.get(`/patients/${resolvedPatientId}/emergency-alerts`),
          currentAccount.role === 'senior' ? api.get(`/patients/${resolvedPatientId}/audit-logs`) : Promise.resolve({ data: [] as Row[] }),
        ])
        const resourceErrorsNext: Record<string, string> = {}
        const medicationResult = results[0]
        const medicationRows = medicationResult.status === 'fulfilled' ? rows(medicationResult.value.data) : []
        if (medicationResult.status === 'rejected') resourceErrorsNext.medications = errorMessage(medicationResult.reason)
        setMedications(medicationRows)
        const scheduleResults = await Promise.allSettled(medicationRows.map((medication) => api.get(`/medications/${idOf(medication)}/schedules`)))

        const allSchedules = scheduleResults.flatMap((result) =>
          result.status === 'fulfilled' ? rows(result.value.data) : [],
        )
        setSchedules(allSchedules)
        if (scheduleResults.some((result) => result.status === 'rejected')) resourceErrorsNext.schedules = 'Some medication reminders could not be loaded.'
        if (results[1].status === 'fulfilled') setAppointments(rows(results[1].value.data))
        else resourceErrorsNext.appointments = errorMessage(results[1].reason)
        if (results[2].status === 'fulfilled') setCheckins(rows(results[2].value.data))
        else resourceErrorsNext.wellness = errorMessage(results[2].reason)
        if (results[5].status === 'fulfilled') setCaregivers(rows(results[5].value.data))
        else resourceErrorsNext.caregivers = errorMessage(results[5].reason)
        if (results[6].status === 'fulfilled') setDoses(rows(results[6].value.data))
        else resourceErrorsNext.doses = errorMessage(results[6].reason)
        const contactResult = results[3]
        const profileResult = results[4]
        const emergencyAlertResult = results[7]
        if (emergencyAlertResult.status === 'fulfilled') {
          setEmergencyAlerts(rows(emergencyAlertResult.value.data))
          setEmergencyAlertsError('')
        } else {
          setEmergencyAlerts([])
          setEmergencyAlertsError(errorMessage(emergencyAlertResult.reason))
        }
        if (results[8].status === 'fulfilled') setAuditLogs(rows(results[8].value.data))
        else resourceErrorsNext.auditLogs = errorMessage(results[8].reason)
        const refillResults = await Promise.allSettled(medicationRows.map((medication) => api.get(`/medications/${idOf(medication)}/refills`)))
        const refillMap: Record<number, Row[]> = {}
        refillResults.forEach((result, index) => { if (result.status === 'fulfilled') refillMap[idOf(medicationRows[index])] = rows(result.value.data) })
        setRefillsByMedication(refillMap)
        if (refillResults.some((result) => result.status === 'rejected')) resourceErrorsNext.refills = 'Some refill reminders could not be loaded.'
        setResourceErrors(resourceErrorsNext)
        if (contactResult.status === 'fulfilled') {
          const contactRows = rows(contactResult.value.data)
          if (contactRows.some((item) => !item.id || !item.full_name || !item.phone)) {
            setContactsError('The server returned incomplete emergency contact details.')
          } else {
            setContacts(contactRows)
            setContactsError('')
          }
        } else {
          setContactsError(errorMessage(contactResult.reason))
        }

        if (profileResult.status === 'fulfilled') {
          const profile = rows(profileResult.value.data)[0] ?? null
          if (profile && (!profile.id || Number(profile.patient_id) !== resolvedPatientId)) {
            setMedicalProfileError('The server returned incomplete medical profile details.')
          } else {
            setMedicalProfile(profile)
            setMedicalProfileError('')
          }
        } else if (errorStatus(profileResult.reason) === 404) {
          setMedicalProfile(null)
          setMedicalProfileError('')
        } else {
          setMedicalProfileError(errorMessage(profileResult.reason))
        }
      }

      if (currentAccount.role === 'caregiver') {
        try {
          const alertResponse = await api.get('/caregiver-alerts')
          setAlerts(rows(alertResponse.data))
        } catch (err) {
          setAlerts([])
          setResourceErrors((previous) => ({ ...previous, alerts: errorMessage(err) }))
        }
      } else {
        setAlerts([])
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const restoreSession = useCallback(async () => {
    const token = sessionStorage.getItem('medalert_token')
    if (!token) {
      setLoading(false)
      return
    }

    try {
      const response = await api.get('/auth/me')
      const currentAccount = response.data as Account
      setAccount(currentAccount)
      await loadDashboard(currentAccount)
    } catch {
      logout()
      setLoading(false)
    }
  }, [loadDashboard, logout])

  useEffect(() => {
    void restoreSession()

    const handleUnauthorized = () => logout()
    window.addEventListener('medalert:unauthorized', handleUnauthorized)

    return () => window.removeEventListener('medalert:unauthorized', handleUnauthorized)
  }, [restoreSession, logout])

  const refresh = async () => {
    if (!account || loading || refreshInProgress.current) return
    refreshInProgress.current = true
    try {
      await loadDashboard(account)
    } finally {
      refreshInProgress.current = false
    }
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const body = new URLSearchParams()
      body.set('username', email)
      body.set('password', password)

      const response = await api.post('/auth/login', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      sessionStorage.setItem('medalert_token', response.data.access_token)
      sessionStorage.setItem('medalert_role', response.data.role)

      const meResponse = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${response.data.access_token}` },
      })

      const currentAccount = meResponse.data as Account
      setAccount(currentAccount)
      await loadDashboard(currentAccount)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      await api.post(caregiverRegisterMode ? '/auth/register/caregiver' : '/auth/register/senior', caregiverRegisterMode
        ? { invitation_code: invitationCode.trim(), email, password }
        : { full_name: fullName.trim(), email, password })
      setRegisterMode(false)
      setCaregiverRegisterMode(false)
      setNotice('Registration successful. Please log in.')
      setPassword('')
      setInvitationCode('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleAddMedication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!patientId) {
      setError('Patient profile could not be identified.')
      return
    }

    const times = medTimes.split(',').map((time) => time.trim()).filter(Boolean)
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/

    if (!times.length || times.some((time) => !validTime.test(time))) {
      setError('Enter reminder times in 24-hour format, separated by commas. Example: 09:00, 21:00.')
      return
    }
    if (new Set(times).size !== times.length) {
      setError('Each reminder time can only be listed once.')
      return
    }
    const expectedTimes = medFrequency === 'Once daily' ? 1 : medFrequency === 'Twice daily' ? 2 : medFrequency === 'Three times daily' ? 3 : times.length
    if (times.length !== expectedTimes) {
      setError(`${medFrequency} requires exactly ${expectedTimes} reminder time${expectedTimes === 1 ? '' : 's'}.`)
      return
    }

    setError('')
    setNotice('')
    setBusy(true)

    try {
      const medicationPayload = {
        name: medName.trim(),
        dosage: medDosage.trim(),
        frequency: medFrequency.trim(),
        reminder_time: times[0],
        is_critical: medCritical,
        grace_period_minutes: Number(medGracePeriod),
        food_instructions: medFoodInstructions.trim() || null,
        reminder_times: times,
      }
      const response = editingMedicationId
        ? await api.put(`/medications/${editingMedicationId}`, { ...medicationPayload, reminder_times: times })
        : await api.post(`/patients/${patientId}/medications`, medicationPayload)

      const medicationId = Number(response.data.medication_id ?? response.data.id ?? editingMedicationId)
      if (!medicationId) throw new Error('Medication ID was not returned.')

      if (medPhoto) {
        const form = new FormData()
        form.append('file', medPhoto)
        await api.post(`/medications/${medicationId}/photo`, form)
      }

      setMedName('')
      setMedDosage('')
      setMedFrequency('Once daily')
      setMedTimes('09:00')
      setMedFoodInstructions('')
      setMedCritical(false)
      setMedGracePeriod('30')
      setMedPhoto(null)
      const wasEditing = Boolean(editingMedicationId)
      setEditingMedicationId(null)
      setNotice(wasEditing ? 'Medication updated successfully.' : 'Medication and reminder schedule added successfully.')
      await refresh()
    } catch (err) {
      await refresh()
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const editMedication = (item: Row) => {
    const scheduleTimes = schedules.filter((schedule) => Number(schedule.medication_id) === idOf(item)).map((schedule) => String(schedule.reminder_time).slice(0, 5))
    setEditingMedicationId(idOf(item)); setMedName(item.name ?? ''); setMedDosage(item.dosage ?? '')
    setMedFrequency(item.frequency ?? 'Once daily'); setMedTimes(scheduleTimes.join(', ') || String(item.reminder_time ?? '').slice(0, 5))
    setMedFoodInstructions(item.food_instructions ?? ''); setMedCritical(Boolean(item.is_critical))
    setMedGracePeriod(String(item.grace_period_minutes ?? 30)); setMedPhoto(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteMedication = async (item: Row) => {
    if (!window.confirm(`Delete ${item.name}? This also removes its dose history, refill reminders and related alerts.`)) return
    try { await api.delete(`/medications/${idOf(item)}`); setNotice('Medication and related records deleted.'); await refresh() }
    catch (err) { setError(errorMessage(err)) }
  }

  const handleAddAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!patientId) {
      setError('Patient profile could not be identified.')
      return
    }

    setError('')
    setNotice('')
    setBusy(true)

    try {
      const payload = {
        patient_id: patientId,
        title: appointmentTitle.trim(),
        appointment_type: appointmentType,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime || null,
        location: appointmentLocation.trim() || null,
        notes: appointmentNotes.trim() || null,
      }
      if (editingAppointmentId) await api.put(`/appointments/${editingAppointmentId}`, payload)
      else await api.post('/appointments', payload)

      setEditingAppointmentId(null)
      setAppointmentTitle('')
      setAppointmentType('appointment')
      setAppointmentDate('')
      setAppointmentTime('')
      setAppointmentLocation('')
      setAppointmentNotes('')
      setNotice(editingAppointmentId ? 'Appointment updated successfully.' : 'Appointment added successfully.')
      await refresh()
    } catch (err) {
      await refresh()
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const editAppointment = (item: Row) => {
    setEditingAppointmentId(idOf(item))
    setAppointmentTitle(item.title ?? '')
    setAppointmentType(item.appointment_type ?? 'appointment')
    setAppointmentDate(String(item.appointment_date ?? '').slice(0, 10))
    setAppointmentTime(String(item.appointment_time ?? '').slice(0, 5))
    setAppointmentLocation(item.location ?? '')
    setAppointmentNotes(item.notes ?? '')
    setPage('appointments')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteAppointment = async (item: Row) => {
    if (!window.confirm(`Delete ${item.title ?? 'this appointment'}?`)) return
    try {
      await api.delete(`/appointments/${idOf(item)}`)
      setNotice('Appointment deleted.')
      await refresh()
    } catch (err) { setError(errorMessage(err)) }
  }

  const handleAddCaregiver = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!patientId) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api.post('/caregivers', { patient_id: patientId, full_name: caregiverName.trim(), email: caregiverEmail.trim(), phone: caregiverPhone.trim() || null, relationship: caregiverRelationship.trim() || null })
      setIssuedInvitationCode(result.data.invitation_code)
      setCaregiverName(''); setCaregiverEmail(''); setCaregiverPhone(''); setCaregiverRelationship('')
      setNotice('Caregiver profile created. Share the one-time code with them securely.')
      await refresh()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const updateCaregiverPermission = async (caregiver: Row, key: PermissionKey, checked: boolean) => {
    if (!patientId) return
    const current = caregiver.permissions ?? {}
    const permissions = Object.fromEntries(Object.keys(permissionLabels).map((name) => [name, name === key ? checked : Boolean(current[name])]))
    try {
      await api.put(`/patients/${patientId}/caregivers/${idOf(caregiver)}/permissions`, permissions)
      setCaregivers((items) => items.map((item) => idOf(item) === idOf(caregiver) ? { ...item, permissions, has_active_access: true } : item))
      setNotice('Caregiver permissions updated.')
    } catch (err) { setError(errorMessage(err)) }
  }

  const revokeCaregiver = async (caregiver: Row) => {
    if (!patientId || !window.confirm(`Revoke ${caregiver.full_name}'s access to your information?`)) return
    try {
      await api.delete(`/patients/${patientId}/caregivers/${idOf(caregiver)}/permissions`)
      await refresh(); setNotice('Caregiver access revoked.')
    } catch (err) { setError(errorMessage(err)) }
  }

  const addRefill = async (event: FormEvent<HTMLFormElement>, medicationId: number) => {
    event.preventDefault()
    const refillDate = refillDates[medicationId]
    if (!refillDate) return
    try {
      await api.post(`/medications/${medicationId}/refills`, { refill_date: refillDate, pharmacy_name: refillPharmacies[medicationId]?.trim() || null })
      setNotice('Refill reminder saved.')
      await refresh()
    } catch (err) { setError(errorMessage(err)) }
  }

  const completeRefill = async (refillId: number) => {
    try { await api.put(`/medication-refills/${refillId}`, { status: 'completed' }); await refresh(); setNotice('Refill marked complete.') }
    catch (err) { setError(errorMessage(err)) }
  }

  const handleDoseAction = async (doseId: number, action: 'taken' | 'skipped' | 'delayed' | 'snooze') => {
    setError('')
    setNotice('')

    try {
      if (action === 'snooze') {
        await api.post(`/medication-doses/${doseId}/snooze?snooze_minutes=10`)
        setNotice('Dose reminder snoozed for 10 minutes.')
      } else {
        await api.post(`/medication-doses/${doseId}/${action}`)
        setNotice(action === 'taken' ? 'Medication marked as taken.' : action === 'delayed' ? 'Dose marked as delayed.' : 'Medication marked as skipped.')
      }
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const completeCheckin = async () => {
    if (!patientId || busy) return

    setError('')
    setNotice('')
    setBusy(true)

    try {
      const now = new Date()
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-')

      const existing = checkins.find((item) =>
        String(item.checkin_date ?? '').slice(0, 10) === today
      )

      if (String(existing?.status ?? '').toLowerCase() === 'checked_in') {
        setNotice("You've already completed today's wellness check-in.")
        return
      }

      if (existing) {
        await api.post(`/wellness-checkins/${idOf(existing)}/complete`)
      } else {
        const created = await api.post('/wellness-checkins', {
          patient_id: patientId,
          checkin_date: today,
          due_time: '20:00:00',
        })

        const checkinId = Number(created.data?.checkin_id)
        if (!checkinId) {
          throw new Error('The wellness check-in could not be identified.')
        }

        await api.post(`/wellness-checkins/${checkinId}/complete`)
      }

      setNotice("Your wellness check-in has been recorded.")
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleAddEmergencyContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!patientId) return

    setError('')
    setNotice('')
    setContactsError('')
    setBusy(true)

    try {
      const contactPayload = {
        patient_id: patientId,
        full_name: contactName.trim(),
        relationship: contactRelationship.trim() || null,
        phone: contactPhone.trim(),
        email: contactEmail.trim() || null,
        is_primary: contactPrimary,
        receives_emergency_alerts: contactReceivesAlerts,
      }
      const response = editingContactId
        ? await api.put(`/emergency-contacts/${editingContactId}`, contactPayload)
        : await api.post('/emergency-contacts', contactPayload)
      if (!response.data?.id || !response.data?.full_name || !response.data?.phone) {
        throw new Error('The contact was saved, but the server did not return its details. Refresh to confirm the saved record.')
      }

      setContacts((previous) => [response.data, ...previous.filter((item) => idOf(item) !== Number(response.data.id))])
      const wasEditing = Boolean(editingContactId)
      setEditingContactId(null)
      setContactName('')
      setContactRelationship('')
      setContactPhone('')
      setContactEmail('')
      setContactPrimary(false)
      setContactReceivesAlerts(true)
      setContactsError('')
      setNotice(wasEditing ? 'Emergency contact updated successfully.' : 'Emergency contact added successfully.')
      await refresh()
    } catch (err) {
      setContactsError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const editEmergencyContact = (item: Row) => {
    setEditingContactId(idOf(item)); setContactName(item.full_name ?? '')
    setContactRelationship(item.relationship ?? ''); setContactPhone(item.phone ?? '')
    setContactEmail(item.email ?? ''); setContactPrimary(Boolean(item.is_primary))
    setContactReceivesAlerts(Boolean(item.receives_emergency_alerts))
    document.getElementById('emergency-contact-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const deleteEmergencyContact = async (item: Row) => {
    if (!window.confirm(`Delete emergency contact ${item.full_name}?`)) return
    try { await api.delete(`/emergency-contacts/${idOf(item)}`); setNotice('Emergency contact deleted.'); await refresh() }
    catch (err) { setContactsError(errorMessage(err)) }
  }

  const handleSaveMedicalProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!patientId) return

    setError('')
    setNotice('')
    setMedicalProfileError('')
    setBusy(true)

    try {
      const fields = [
        'blood_group',
        'allergies',
        'medical_conditions',
        'physician_name',
        'physician_phone',
        'physician_address',
        'insurance_provider',
        'insurance_policy_number',
        'insurance_member_id',
      ]

      const payload: Row = { patient_id: patientId }
      for (const field of fields) {
        payload[field] = String(medicalForm[field] ?? '').trim() || null
      }

      const response = await api.post('/medical-profile', payload)
      if (!response.data?.id || Number(response.data.patient_id) !== patientId) {
        throw new Error('The profile was saved, but the server did not return its details. Refresh to confirm the saved record.')
      }
      setMedicalProfile(rows(response.data)[0] ?? response.data)
      setMedicalProfileError('')
      setEditingMedicalProfile(false)
      setNotice('Medical profile saved successfully.')
      await refresh()
    } catch (err) {
      setMedicalProfileError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const triggerEmergency = async () => {
    if (!patientId || busy) return
    const confirmed = window.confirm(
      'Trigger an emergency alert for this patient? This records an alert in MedAlert AI but does not guarantee that emergency services will be contacted.',
    )
    if (!confirmed) return

    setError('')
    setNotice('')
    setBusy(true)

    try {
      await api.post('/emergency/trigger', {
        patient_id: patientId,
        message: 'Emergency assistance requested through MedAlert AI.',
      })
      setNotice('Emergency alert recorded. Contact emergency services directly if immediate help is needed.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const acknowledgeAlert = async (alertId: number) => {
    try {
      await api.post(`/caregiver-alerts/${alertId}/acknowledge`)
      setNotice('Alert acknowledged.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const doseDetails: (Row & { schedule?: Row; medication?: Row })[] = useMemo(() => {
    return doses.map((dose) => {
      const schedule = schedules.find(
        (item) => idOf(item) === Number(dose.schedule_id),
      )
      const medication = medications.find(
        (item) => idOf(item) === Number(schedule?.medication_id),
      )
      return { ...dose, schedule, medication }
    })
  }, [doses, schedules, medications])

  const pendingDoses = doseDetails.filter((dose) =>
    String(dose.status ?? 'pending').toLowerCase() === 'pending',
  )

  const displayName = patient?.full_name ?? patient?.name ?? account?.email ?? 'MedAlert user'
  const roleLabel = account?.role === 'senior' ? 'Senior patient' : 'Caregiver'

  if (loading && !account) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <Activity size={30} />
          <h2>MedAlert AI</h2>
          <p>Loading your account...</p>
        </div>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-icon"><Heart size={25} /></div>
            <div>
              <h1>MedAlert AI</h1>
              <p>Medication and care management</p>
            </div>
          </div>

          <h2>{registerMode ? (caregiverRegisterMode ? 'Join a care team' : 'Create your account') : 'Welcome back'}</h2>
          <p className="auth-subtitle">
            {registerMode
              ? caregiverRegisterMode ? 'Use the one-time invitation from your senior patient.' : 'Register as a senior patient to get started.'
              : 'Sign in to access your care dashboard.'}
          </p>

          {error && <div className="notice error"><AlertCircle size={17} />{error}</div>}
          {notice && <div className="notice success"><CheckCircle2 size={17} />{notice}</div>}

          <form onSubmit={registerMode ? handleRegister : handleLogin} className="auth-form">
            {registerMode && !caregiverRegisterMode && (
              <label>
                Full name
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
            )}
            {registerMode && caregiverRegisterMode && <label>One-time invitation code<input value={invitationCode} onChange={(e) => setInvitationCode(e.target.value)} required autoComplete="off" /></label>}
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={registerMode ? 'new-password' : 'current-password'}
                required
              />
            </label>
            <button className="primary-button auth-submit" type="submit" disabled={busy}>
              {busy ? 'Please wait...' : registerMode ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <button
            className="text-button"
            onClick={() => {
              setRegisterMode(!registerMode)
              setCaregiverRegisterMode(false)
              setError('')
              setNotice('')
            }}
          >
            {registerMode ? 'Already have an account? Sign in' : 'New senior patient? Create an account'}
          </button>
          {!registerMode && <button className="text-button" onClick={() => { setRegisterMode(true); setCaregiverRegisterMode(true); setError(''); setNotice('') }}>Register with caregiver invitation</button>}

          <p className="auth-footnote">
            Caregiver accounts must be created and linked by a senior patient.
          </p>
        </div>
      </div>
    )
  }

  const renderOverview = () => (
    <>
      <div className="welcome-row">
        <div>
          <h2>Hello, {displayName}</h2>
          <p>Here is your care overview.</p>
        </div>
        <span className="role-label">{account.role === 'senior' ? 'Senior account' : 'Caregiver account'}</span>
      </div>

      <div className="stats-grid">
        <StatCard icon={<Pill />} label="Medications" value={resourceErrors.medications ? '—' : medications.length} detail="Registered medications" />
        <StatCard icon={<Clock />} label="Pending doses" value={resourceErrors.doses || resourceErrors.medications ? '—' : pendingDoses.length} detail="Awaiting action" />
        <StatCard icon={<CalendarDays />} label="Appointments" value={resourceErrors.appointments ? '—' : appointments.length} detail="Scheduled records" />
        <StatCard icon={<Heart />} label="Wellness check-ins" value={resourceErrors.wellness ? '—' : checkins.length} detail="Recorded check-ins" />
      </div>
      {resourceErrors.wellness && <ResourceError text={resourceErrors.wellness} onRetry={() => void refresh()} />}

      {account.role === 'caregiver' && (
        <section className="panel">
          <div className="panel-heading">
            <div><h3>Caregiver alerts</h3><p>Alerts associated with your linked patient.</p></div>
            <Users size={21} />
          </div>
          {resourceErrors.alerts ? <ResourceError text={resourceErrors.alerts} onRetry={() => void refresh()} /> : alerts.length === 0 ? <EmptyState text="No caregiver alerts are currently available." /> :
            alerts.map((alert) => (
              <div className="alert-row" key={idOf(alert)}>
                <div><strong>{alert.message ?? alert.alert_type ?? 'Care alert'}</strong><p>{dateLabel(alert.created_at)}</p></div>
                <button className="small-button" onClick={() => acknowledgeAlert(idOf(alert))}>Acknowledge</button>
              </div>
            ))}
        </section>
      )}

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div><h3>Medication schedule</h3><p>Your recorded medication doses.</p></div>
            <Pill size={21} />
          </div>
          {resourceErrors.medications && <ResourceError text={resourceErrors.medications} onRetry={() => void refresh()} />}
          {resourceErrors.doses && <ResourceError text={resourceErrors.doses} onRetry={() => void refresh()} />}
          {!resourceErrors.medications && !resourceErrors.doses && pendingDoses.length === 0 ? <EmptyState text="No pending medication doses were returned by the backend." /> :
            pendingDoses.slice(0, 5).map((dose) => (
              <MedicationRow
                key={idOf(dose)}
                dose={dose}
                onAction={handleDoseAction}
                disabled={account.role !== 'senior'}
              />
            ))}
          <button className="text-button" onClick={() => setPage('medications')}>View medications</button>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><h3>Upcoming appointments</h3><p>Appointments and lab tests.</p></div>
            <CalendarDays size={21} />
          </div>
          {resourceErrors.appointments && <ResourceError text={resourceErrors.appointments} onRetry={() => void refresh()} />}
          {!resourceErrors.appointments && appointments.length === 0 ? <EmptyState text="No appointment records found." /> :
            appointments.slice(0, 4).map((item) => <AppointmentItem key={idOf(item)} item={item} />)}
          <button className="text-button" onClick={() => setPage('appointments')}>View appointments</button>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div><h3>Care information</h3><p>Information currently available from your profile.</p></div>
          <UserRound size={21} />
        </div>
        {contactsError && <ResourceError text={`Emergency contacts: ${contactsError}`} onRetry={() => void refresh()} />}
        {medicalProfileError && <ResourceError text={`Medical profile: ${medicalProfileError}`} onRetry={() => void refresh()} />}
        <div className="info-grid">
          <InfoItem label="Patient" value={displayName} />
          <InfoItem label="Email" value={patient?.email ?? account.email} />
          <InfoItem label="Emergency contacts" value={contactsError ? 'Unavailable' : String(contacts.length)} />
          <InfoItem label="Medical profile" value={medicalProfileError ? 'Unavailable' : medicalProfile ? 'Available' : 'Not added'} />
        </div>
      </section>
    </>
  )

  const renderMedications = () => (
    <section className="page-panel">
      <div className="page-heading">
        <div><h2>Medications</h2><p>Medication records and dose actions.</p></div>
        <Pill size={25} />
      </div>
      {resourceErrors.medications && <ResourceError text={`Medications could not be loaded: ${resourceErrors.medications}`} onRetry={() => void refresh()} />}
      {resourceErrors.schedules && <ResourceError text={resourceErrors.schedules} onRetry={() => void refresh()} />}
      {resourceErrors.refills && <ResourceError text={resourceErrors.refills} onRetry={() => void refresh()} />}

      {account.role === 'senior' && (
        <form className="medication-form" onSubmit={handleAddMedication}>
          <div className="medication-form-heading">
            <div>
              <h3>{editingMedicationId ? 'Edit medication' : 'Add a medication'}</h3>
              <p>Enter the medication details and set daily reminder times.</p>
            </div>
            <div className="medication-form-icon"><Pill size={22} /></div>
          </div>

          <div className="medication-form-grid">
            <label className="medication-field">
              <span>Medication name</span>
              <input value={medName} onChange={(e) => setMedName(e.target.value)} required maxLength={150} placeholder="e.g. Paracetamol" />
            </label>

            <label className="medication-field">
              <span>Dosage</span>
              <input value={medDosage} onChange={(e) => setMedDosage(e.target.value)} required placeholder="e.g. 500 mg" />
            </label>

            <label className="medication-field">
              <span>Frequency</span>
              <select value={medFrequency} onChange={(e) => setMedFrequency(e.target.value)} required>
                <option>Once daily</option><option>Twice daily</option><option>Three times daily</option><option>Custom daily schedule</option>
              </select>
            </label>

            <label className="medication-field">
              <span>Reminder times</span>
              <input value={medTimes} onChange={(e) => setMedTimes(e.target.value)} required placeholder="09:00, 21:00" />
              <small>Use 24-hour time. Separate multiple reminders with commas.</small>
            </label>

            <label className="medication-field">
              <span>Grace period</span>
              <input type="number" min="1" max="1440" value={medGracePeriod} onChange={(e) => setMedGracePeriod(e.target.value)} required />
              <small>Minutes allowed after the scheduled time.</small>
            </label>

            <label className="medication-field">
              <span>Food instructions <small>(Optional)</small></span>
              <input value={medFoodInstructions} onChange={(e) => setMedFoodInstructions(e.target.value)} placeholder="e.g. Take after food" />
            </label>
            <label className="medication-field">
              <span>Medication photo <small>(Optional JPG or PNG, max 5 MB)</small></span>
              <input type="file" accept="image/jpeg,image/png" onChange={(e) => setMedPhoto(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          <div className="medication-form-footer">
            <label className="medication-critical">
              <input type="checkbox" checked={medCritical} onChange={(e) => setMedCritical(e.target.checked)} />
              <span>
                <strong>Critical medication</strong>
                <small>Mark if this medication is especially important.</small>
              </span>
            </label>

            <div className="record-actions"><button className="medication-save-button" type="submit" disabled={busy}>{busy ? 'Saving...' : editingMedicationId ? 'Update medication' : 'Save medication and reminders'}</button>{editingMedicationId && <button type="button" className="small-button" onClick={() => { setEditingMedicationId(null); setMedName(''); setMedDosage(''); setMedFrequency('Once daily'); setMedTimes('09:00'); setMedFoodInstructions(''); setMedCritical(false); setMedGracePeriod('30'); setMedPhoto(null) }}>Cancel</button>}</div>
          </div>
        </form>
      )}
      {medications.length === 0 && !resourceErrors.medications && <EmptyState text="No medication records were found for this patient." />}

      {medications.map((medication) => {
        const medicationSchedules = schedules.filter(
          (schedule) => Number(schedule.medication_id) === idOf(medication),
        )
        return (
          <div className="medication-card" key={idOf(medication)}>
            <div className="medication-card-heading">
              <div className="medication-icon"><Pill size={20} /></div>
              <div>
                <h3>{medication.name ?? 'Medication'}</h3>
                <p>{medication.dosage ?? 'Dosage not specified'} · {medication.frequency ?? 'Frequency not specified'}</p>
              </div>
            </div>
            {medicationPhotos[idOf(medication)] && <img className="medication-photo" src={medicationPhotos[idOf(medication)]} alt={`${medication.name} package`} />}
            {medication.food_instructions && <p className="muted-text">{medication.food_instructions}</p>}
            <p className="muted-text">{medication.is_critical ? 'Critical medication' : 'Standard medication'}</p>
            {account.role === 'senior' && <div className="record-actions"><button className="small-button" aria-label={`Edit ${medication.name}`} onClick={() => editMedication(medication)}><Pencil size={16} /> Edit</button><button className="small-button danger-button" aria-label={`Delete ${medication.name}`} onClick={() => void deleteMedication(medication)}><Trash2 size={16} /> Delete</button></div>}
            <div className="schedule-list">
              {medicationSchedules.length === 0 ? <p>No schedule records found.</p> :
                medicationSchedules.map((schedule) => (
                  <span key={idOf(schedule)}><Clock size={14} /> {timeLabel(schedule.reminder_time)}</span>
                ))}
            </div>
            <section className="inline-form">
              <h4>Refill reminders</h4>
              {(refillsByMedication[idOf(medication)] ?? []).length === 0 && !resourceErrors.refills && <p className="muted-text">No refill reminders saved.</p>}
              {(refillsByMedication[idOf(medication)] ?? []).map((refill) => {
                const days = Math.ceil((new Date(`${String(refill.refill_date).slice(0, 10)}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
                return <div className="refill-row" key={idOf(refill)}><span>{dateLabel(refill.refill_date)} · {days < 0 ? `${Math.abs(days)} days overdue` : `${days} days left`} · {refill.status}</span>{account.role === 'senior' && refill.status === 'pending' && <button type="button" className="small-button" onClick={() => completeRefill(idOf(refill))}>Mark complete</button>}</div>
              })}
              {account.role === 'senior' && <form className="refill-form" onSubmit={(event) => addRefill(event, idOf(medication))}>
                <input aria-label={`Refill date for ${medication.name}`} type="date" required value={refillDates[idOf(medication)] ?? ''} onChange={(e) => setRefillDates((old) => ({ ...old, [idOf(medication)]: e.target.value }))} />
                <input aria-label="Pharmacy name" placeholder="Pharmacy (optional)" value={refillPharmacies[idOf(medication)] ?? ''} onChange={(e) => setRefillPharmacies((old) => ({ ...old, [idOf(medication)]: e.target.value }))} />
                <button type="submit" className="small-button">Save refill reminder</button>
              </form>}
            </section>
          </div>
        )
      })}

      <div className="panel-heading dose-heading"><div><h3>Dose actions</h3><p>Actions are available for pending doses.</p></div></div>
      {pendingDoses.length === 0 && !resourceErrors.doses ? <EmptyState text="There are no pending doses." /> :
        pendingDoses.map((dose) => (
          <MedicationRow key={idOf(dose)} dose={dose} onAction={handleDoseAction} disabled={account.role !== 'senior'} />
        ))}
      {account.role === 'caregiver' && <p className="muted-text">Caregiver accounts can view information but cannot record medication actions.</p>}
      {doseDetails.some((dose) => String(dose.status).toLowerCase() !== 'pending') && <section className="dose-history"><h3>Recent dose history</h3>{doseDetails.filter((dose) => String(dose.status).toLowerCase() !== 'pending').slice(0, 8).map((dose) => <div className="dose-history-row" key={idOf(dose)}><span>{dose.medication?.name ?? 'Medication'} · {dateLabel(String(dose.scheduled_for ?? ''))} · {timeLabel(String(dose.scheduled_for ?? ''))}</span><span className={`status-pill ${dose.status === 'missed' ? 'status-alert' : dose.status === 'taken' ? 'status-done' : 'status-muted'}`}>{String(dose.status).replace('_', ' ')}</span></div>)}</section>}
    </section>
  )

  const renderAppointments = () => (
    <section className="page-panel">
      <div className="page-heading">
        <div><h2>Appointments</h2><p>Appointments and lab test records from your account.</p></div>
        <CalendarDays size={25} />
      </div>
      {resourceErrors.appointments && <ResourceError text={resourceErrors.appointments} onRetry={() => void refresh()} />}
      {account.role === 'senior' && (
        <form className="medication-form" onSubmit={handleAddAppointment}>
          <div className="medication-form-heading">
            <div>
              <h3>{editingAppointmentId ? 'Edit appointment' : 'Add an appointment'}</h3>
              <p>Save an upcoming doctor appointment or lab test.</p>
            </div>
            <div className="medication-form-icon"><CalendarDays size={22} /></div>
          </div>

          <div className="medication-form-grid">
            <label className="medication-field">
              <span>Appointment title</span>
              <input
                value={appointmentTitle}
                onChange={(e) => setAppointmentTitle(e.target.value)}
                required
                maxLength={150}
                placeholder="e.g. General physician visit"
              />
            </label>

            <label className="medication-field">
              <span>Appointment type</span>
              <select
                value={appointmentType}
                onChange={(e) => setAppointmentType(e.target.value)}
                required
              >
                <option value="appointment">Doctor appointment</option>
                <option value="lab_test">Lab test</option>
              </select>
            </label>

            <label className="medication-field">
              <span>Date</span>
              <input
                type="date"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                required
              />
            </label>

            <label className="medication-field">
              <span>Time <small>(Optional)</small></span>
              <input
                type="time"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
              />
            </label>

            <label className="medication-field">
              <span>Location <small>(Optional)</small></span>
              <input
                value={appointmentLocation}
                onChange={(e) => setAppointmentLocation(e.target.value)}
                placeholder="Hospital or laboratory name"
              />
            </label>

            <label className="medication-field">
              <span>Notes <small>(Optional)</small></span>
              <input
                value={appointmentNotes}
                onChange={(e) => setAppointmentNotes(e.target.value)}
                placeholder="Additional details"
              />
            </label>
          </div>

          <div className="medication-form-footer">
            <span className="muted-text">Appointments and lab tests are saved to your care record.</span>
            {editingAppointmentId && <button type="button" className="small-button" onClick={() => { setEditingAppointmentId(null); setAppointmentTitle(''); setAppointmentDate(''); setAppointmentTime(''); setAppointmentLocation(''); setAppointmentNotes('') }}>Cancel edit</button>}
            <button className="medication-save-button" type="submit" disabled={busy}>
              {busy ? 'Saving...' : editingAppointmentId ? 'Update appointment' : 'Save appointment'}
            </button>
          </div>
        </form>
      )}

          {appointments.length === 0 && !resourceErrors.appointments ? <EmptyState text="No appointments have been recorded." /> :
        appointments.map((item) => <div className="appointment-record" key={idOf(item)}><AppointmentItem item={item} />{account.role === 'senior' && <div className="appointment-actions"><button className="small-button" onClick={() => editAppointment(item)}>Edit</button><button className="small-button" onClick={() => void deleteAppointment(item)}>Delete</button></div>}</div>)}
    </section>
  )

  const renderCheckins = () => {
    const now = new Date()
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')

    const todaysCheckin = checkins.find(
      (item) => String(item.checkin_date ?? '').slice(0, 10) === today,
    )
    const isCompleted =
      String(todaysCheckin?.status ?? '').toLowerCase() === 'checked_in'

    return (
      <section className="page-panel">
        {resourceErrors.wellness && <ResourceError text={resourceErrors.wellness} onRetry={() => void refresh()} />}
        <div className="page-heading">
          <div>
            <h2>Wellness</h2>
            <p>Your daily safety check-in.</p>
          </div>
          <Heart size={25} />
        </div>

        {account.role === 'senior' && (
          <div className={`wellness-action ${isCompleted ? 'wellness-completed' : ''}`}>
            <div className="wellness-message">
              <div className="wellness-icon">
                <Heart size={30} />
              </div>
              <h3>Are you okay today?</h3>
              <p>
                {isCompleted
                  ? "Thank you for checking in. Your daily response has been recorded."
                  : "Let your care circle know you're okay. Tap the button below to check in."}
              </p>
              {todaysCheckin && (
                <span className={`status-pill ${isCompleted ? 'status-done' : 'status-pending'}`}>
                  {isCompleted ? 'Checked in' : 'Pending'}
                </span>
              )}
            </div>

            {isCompleted ? (
              <div className="wellness-success">
                <Heart size={22} />
                <strong>I'm okay today</strong>
                <span>Check-in completed</span>
              </div>
            ) : (
              <button
                className="wellness-checkin-button"
                onClick={completeCheckin}
                disabled={busy}
              >
                <Heart size={22} />
                {busy ? 'Recording check-in...' : "I'm okay today"}
              </button>
            )}
          </div>
        )}

        <div className="wellness-history">
          <h3>Check-in history</h3>
          {checkins.length === 0 && !resourceErrors.wellness ? (
            <EmptyState text="No wellness check-in records were found." />
          ) : (
            checkins.map((item) => {
              const status = String(item.status ?? '').toLowerCase()
              const completed = status === 'checked_in'
              const missed = status === 'missed'

              return (
                <div className="record-row" key={idOf(item)}>
                  <div>
                    <strong>{dateLabel(item.checkin_date)}</strong>
                    <p>Due at {timeLabel(item.due_time)}</p>
                  </div>
                  <span className={`status-pill ${completed ? 'status-done' : missed ? 'status-alert' : 'status-pending'}`}>
                    {completed ? 'Checked in' : missed ? 'Missed' : 'Pending'}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </section>
    )
  }

  const renderEmergency = () => (
    <section className="page-panel emergency-panel">
      <div className="page-heading">
        <div>
          <h2>Emergency assistance</h2>
          <p>Manage emergency contacts and your personal medical information.</p>
        </div>
        <ShieldAlert size={25} />
      </div>

      <div className="emergency-warning">
        <AlertTriangle size={22} />
        <div>
          <strong>Important</strong>
          <p>The emergency button records an alert in MedAlert AI. It does not automatically contact emergency services.</p>
        </div>
      </div>

      {account.role === 'senior' && (
        <button className="emergency-button" onClick={triggerEmergency} disabled={busy}>
          <ShieldAlert size={20} /> Trigger emergency alert
        </button>
      )}

      <section className="emergency-section">
        <h3>Recorded emergency alerts</h3>
        {emergencyAlertsError ? <ResourceError text={emergencyAlertsError} onRetry={() => void refresh()} /> : emergencyAlerts.length === 0 ? <EmptyState text="No emergency alerts have been recorded." /> : emergencyAlerts.map((item) => {
          const contact = contacts.find((entry) => idOf(entry) === Number(item.emergency_contact_id))
          return <div className="record-row" key={idOf(item)}><div><strong>{contact?.full_name ?? 'Emergency contact'}</strong><p>{item.message} · {dateLabel(item.created_at)}</p></div><span className="status-pill status-pending">{item.status}</span></div>
        })}
      </section>

      <div className="emergency-section">
        <h3>Emergency contacts</h3>
        <p className="muted-text">People who can be contacted if you need assistance.</p>

        {contactsError && <ResourceError text={`Emergency contacts could not be loaded: ${contactsError}`} onRetry={() => void refresh()} />}
        {loading && contacts.length === 0 && !contactsError ? (
          <p className="resource-loading" role="status">Loading emergency contacts…</p>
        ) : contacts.length === 0 && !contactsError ? (
          <EmptyState text="No emergency contacts have been added." />
        ) : contacts.map((contact) => (
          <article className="contact-card" key={idOf(contact)}>
            <div className="contact-card-icon"><UserRound size={22} /></div>
            <div className="contact-card-content">
              <div className="contact-card-heading">
                <div>
                  <h4>{contact.full_name}</h4>
                  <p>{contact.relationship || 'Emergency contact'}</p>
                </div>
                <div className="contact-tags">
                  {contact.is_primary && <span className="status-pill status-done">Primary</span>}
                  <span className={`status-pill ${contact.receives_emergency_alerts ? 'status-done' : 'status-muted'}`}>
                    {contact.receives_emergency_alerts ? 'Emergency alerts enabled' : 'Emergency alerts off'}
                  </span>
                </div>
              </div>
              <p className="contact-detail"><strong>Phone</strong><a href={`tel:${contact.phone}`}>{contact.phone}</a></p>
              {contact.email && <p className="contact-detail"><strong>Email</strong><a href={`mailto:${contact.email}`}>{contact.email}</a></p>}
              {account.role === 'senior' && <div className="record-actions"><button className="small-button" aria-label={`Edit ${contact.full_name}`} onClick={() => editEmergencyContact(contact)}><Pencil size={16} /> Edit</button><button className="small-button danger-button" aria-label={`Delete ${contact.full_name}`} onClick={() => void deleteEmergencyContact(contact)}><Trash2 size={16} /> Delete</button></div>}
            </div>
          </article>
        ))}

        {account.role === 'senior' && (
          <form id="emergency-contact-form" className="medication-form" onSubmit={handleAddEmergencyContact}>
            <div className="medication-form-heading">
              <div>
                <h3>{editingContactId ? 'Edit emergency contact' : 'Add emergency contact'}</h3>
                <p>Enter the details of someone who can help you.</p>
              </div>
              <div className="medication-form-icon"><Users size={22} /></div>
            </div>

            <div className="medication-form-grid">
              <label className="medication-field">
                <span>Full name</span>
                <input autoComplete="name" value={contactName} onChange={(e) => setContactName(e.target.value)} required maxLength={150} placeholder="Contact name" />
              </label>

              <label className="medication-field">
                <span>Relationship</span>
                <input value={contactRelationship} onChange={(e) => setContactRelationship(e.target.value)} placeholder="e.g. Son, Daughter, Friend" />
              </label>

              <label className="medication-field">
                <span>Phone number</span>
                <input type="tel" inputMode="tel" autoComplete="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} required placeholder="Phone number" />
              </label>

              <label className="medication-field">
                <span>Email address (optional)</span>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="name@example.com" />
              </label>
            </div>

            <div className="emergency-checkboxes">
              <label>
                <input type="checkbox" checked={contactPrimary} onChange={(e) => setContactPrimary(e.target.checked)} />
                Set as primary contact
              </label>
              <label>
                <input type="checkbox" checked={contactReceivesAlerts} onChange={(e) => setContactReceivesAlerts(e.target.checked)} />
                Include in emergency alerts
              </label>
            </div>

            <div className="record-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving...' : editingContactId ? 'Update emergency contact' : 'Save emergency contact'}</button>{editingContactId && <button className="small-button" type="button" onClick={() => { setEditingContactId(null); setContactName(''); setContactRelationship(''); setContactPhone(''); setContactEmail(''); setContactPrimary(false); setContactReceivesAlerts(true) }}>Cancel</button>}</div>
          </form>
        )}
      </div>

      <div className="emergency-section">
        <h3>Medical profile</h3>
        <p className="muted-text">Important medical information for your care.</p>

        {medicalProfileError && <ResourceError text={`Medical profile could not be loaded: ${medicalProfileError}`} onRetry={() => void refresh()} />}
        {loading && !medicalProfile && !medicalProfileError && <p className="resource-loading" role="status">Loading medical profile…</p>}
        {medicalProfile && <><MedicalProfileSummary profile={medicalProfile} />{account.role === 'senior' && !editingMedicalProfile && <button className="small-button" onClick={() => setEditingMedicalProfile(true)}><Pencil size={16} /> Edit medical profile</button>}</>}

        {account.role === 'senior' && (!medicalProfile || editingMedicalProfile) ? (
          <form className="medication-form" onSubmit={handleSaveMedicalProfile}>
            <div className="medication-form-heading"><h3>{medicalProfile ? 'Edit medical profile' : 'Add medical profile'}</h3></div>
            <div className="medication-form-grid">
              <label className="medication-field">
                <span>Blood group</span>
                <select value={medicalForm.blood_group ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, blood_group: e.target.value }))}>
                  <option value="">Select blood group</option>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </label>

              <label className="medication-field">
                <span>Allergies</span>
                <textarea value={medicalForm.allergies ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, allergies: e.target.value }))} placeholder="List known allergies or write None" rows={3} />
              </label>

              <label className="medication-field">
                <span>Medical conditions</span>
                <textarea value={medicalForm.medical_conditions ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, medical_conditions: e.target.value }))} placeholder="List existing medical conditions" rows={3} />
              </label>

              <label className="medication-field">
                <span>Physician name</span>
                <input value={medicalForm.physician_name ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, physician_name: e.target.value }))} placeholder="Doctor's name" />
              </label>

              <label className="medication-field">
                <span>Physician phone</span>
                <input type="tel" value={medicalForm.physician_phone ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, physician_phone: e.target.value }))} placeholder="Doctor's phone number" />
              </label>

              <label className="medication-field">
                <span>Physician address</span>
                <textarea value={medicalForm.physician_address ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, physician_address: e.target.value }))} placeholder="Clinic or hospital address" rows={2} />
              </label>

              <label className="medication-field">
                <span>Insurance provider</span>
                <input value={medicalForm.insurance_provider ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, insurance_provider: e.target.value }))} placeholder="Insurance company" />
              </label>

              <label className="medication-field">
                <span>Insurance policy number</span>
                <input value={medicalForm.insurance_policy_number ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, insurance_policy_number: e.target.value }))} placeholder="Policy number" />
              </label>

              <label className="medication-field">
                <span>Insurance member ID</span>
                <input value={medicalForm.insurance_member_id ?? ''} onChange={(e) => setMedicalForm((prev) => ({ ...prev, insurance_member_id: e.target.value }))} placeholder="Member ID" />
              </label>
            </div>

            <div className="record-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save medical profile'}</button>{medicalProfile && editingMedicalProfile && <button className="small-button" type="button" onClick={() => { setMedicalForm({ blood_group: medicalProfile.blood_group ?? '', allergies: medicalProfile.allergies ?? '', medical_conditions: medicalProfile.medical_conditions ?? '', physician_name: medicalProfile.physician_name ?? '', physician_phone: medicalProfile.physician_phone ?? '', physician_address: medicalProfile.physician_address ?? '', insurance_provider: medicalProfile.insurance_provider ?? '', insurance_policy_number: medicalProfile.insurance_policy_number ?? '', insurance_member_id: medicalProfile.insurance_member_id ?? '' }); setEditingMedicalProfile(false) }}>Cancel</button>}</div>
          </form>
        ) : (
          !medicalProfile && !medicalProfileError && !loading ? (
            <EmptyState text="No medical profile has been added." />
          ) : null
        )}
      </div>
    </section>
  )

  const renderCaregivers = () => (
    <section className="page-panel">
      <div className="page-heading"><div><h2>Care team</h2><p>{account.role === 'senior' ? 'Invite a caregiver and choose the information they can access.' : 'Your linked senior patient manages caregiver access.'}</p></div><Users size={25} /></div>
      {resourceErrors.caregivers && <ResourceError text={resourceErrors.caregivers} onRetry={() => void refresh()} />}
      {account.role === 'senior' && <form className="medication-form" onSubmit={handleAddCaregiver}>
        <div className="medication-form-heading"><div><h3>Invite a caregiver</h3><p>A one-time code is valid for seven days.</p></div><UserPlus size={22} /></div>
        <div className="medication-form-grid">
          <label className="medication-field"><span>Name</span><input required value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} /></label>
          <label className="medication-field"><span>Email</span><input required type="email" value={caregiverEmail} onChange={(e) => setCaregiverEmail(e.target.value)} /></label>
          <label className="medication-field"><span>Phone (optional)</span><input value={caregiverPhone} onChange={(e) => setCaregiverPhone(e.target.value)} /></label>
          <label className="medication-field"><span>Relationship (optional)</span><input value={caregiverRelationship} onChange={(e) => setCaregiverRelationship(e.target.value)} /></label>
        </div>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create caregiver invitation'}</button>
        {issuedInvitationCode && <p className="notice success">One-time code: <strong>{issuedInvitationCode}</strong> · Share it directly with the invited caregiver.</p>}
      </form>}
      {account.role === 'caregiver' && <p className="muted-text">You are linked to {displayName}. Your senior patient manages your access.</p>}
      {caregivers.map((caregiver) => <article className="panel caregiver-card" key={idOf(caregiver)}>
        <h3>{caregiver.full_name}</h3><p>{caregiver.relationship || 'Caregiver'} · {caregiver.email} · {caregiver.is_registered ? caregiver.has_active_access ? 'Access active' : 'Access revoked' : 'Invitation pending'}</p>
        {account.role === 'senior' && <><div className="permission-grid">{(Object.keys(permissionLabels) as PermissionKey[]).map((key) => <label key={key}><input type="checkbox" disabled={!caregiver.is_registered} checked={Boolean(caregiver.permissions?.[key])} onChange={(e) => updateCaregiverPermission(caregiver, key, e.target.checked)} />{permissionLabels[key]}</label>)}</div><div className="record-actions caregiver-actions">{caregiver.is_registered && caregiver.has_active_access && <button className="small-button danger-button" onClick={() => void revokeCaregiver(caregiver)}>Revoke access</button>}<span className="muted-text">Caregiver profile deletion is unavailable; you can revoke access at any time.</span></div></>}
      </article>)}
      {account.role === 'senior' && !caregivers.length && !resourceErrors.caregivers && <EmptyState text="No caregivers have been invited yet." />}
      {account.role === 'senior' && <details className="audit-history"><summary>Recent account activity</summary>{resourceErrors.auditLogs && <ResourceError text={resourceErrors.auditLogs} onRetry={() => void refresh()} />}{!resourceErrors.auditLogs && auditLogs.slice(0, 12).map((item) => <div className="record-row" key={idOf(item)}><div><strong>{String(item.action ?? 'Account activity').replaceAll('_', ' ')}</strong><p>{String(item.resource_type ?? 'record').replaceAll('_', ' ')} · {dateLabel(item.created_at)}</p></div></div>)}</details>}
    </section>
  )

  const pageContent = {
    overview: renderOverview,
    medications: renderMedications,
    appointments: renderAppointments,
    checkins: renderCheckins,
    emergency: renderEmergency,
    caregivers: renderCaregivers,
  }[page]()

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-icon"><Heart size={22} /></div>
          <div><strong>MedAlert AI</strong><span>Care dashboard</span></div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X /></button>
        </div>

        <nav className="navigation">
          <span className="nav-caption">YOUR CARE</span>
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => {
                  setPage(item.id)
                  setMobileOpen(false)
                }}
              >
                <Icon size={19} /> <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-profile">
            <div className="avatar"><UserRound size={19} /></div>
            <div className="sidebar-profile-info"><strong title={displayName}>{displayName}</strong><span>{roleLabel}</span></div>
          </div>
          <button className="logout-button" onClick={() => {
            if (window.confirm('Sign out of MedAlert AI?')) logout()
          }}><LogOut size={17} /> <span>Sign out</span></button>
        </div>
      </aside>

      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu /></button>
          <div className="topbar-heading">
            <span className="topbar-label">MEDALERT AI</span>
            <h1>{navigation.find((item) => item.id === page)?.label}</h1>
            <p>{pageDescriptions[page]}</p>
          </div>
          <button className="refresh-button" onClick={() => void refresh()} disabled={loading} aria-label={loading ? 'Refreshing records' : 'Refresh records'}>
            <RefreshCw size={16} className={loading ? 'refresh-spinner' : ''} /> <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </header>

        <div className="content">
          {error && <div className="notice error"><AlertCircle size={17} />{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
          {notice && <div className="notice success"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
          {loading && account && <p className="loading-line">Refreshing your records...</p>}
          {pageContent}
          <footer className="footer">MedAlert AI · Medication and care management</footer>
        </div>
      </main>
    </div>
  )
}

function StatCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: number | string; detail: string }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </div>
  )
}

function MedicationRow({
  dose,
  onAction,
  disabled,
}: {
  dose: Row & { medication?: Row }
  onAction: (id: number, action: 'taken' | 'skipped' | 'delayed' | 'snooze') => void
  disabled: boolean
}) {
  const medicationName = dose.medication?.name ?? `Medication dose #${idOf(dose)}`
  const dosage = dose.medication?.dosage ?? 'Dosage unavailable'
  const reminder = dose.schedule?.reminder_time ?? dose.scheduled_for

  return (
    <div className="medication-row">
      <div className="medication-row-icon"><Pill size={19} /></div>
      <div className="medication-row-info">
        <strong>{medicationName}</strong>
        <span>{dosage} · {timeLabel(reminder)}</span>
      </div>
      <div className="dose-actions">
        <button className="dose-taken" aria-label="Mark as taken" disabled={disabled} onClick={() => onAction(idOf(dose), 'taken')} title="Mark taken"><Check size={16} /></button>
        <button className="dose-snooze" aria-label="Mark as delayed" disabled={disabled} onClick={() => onAction(idOf(dose), 'delayed')} title="Mark delayed">Delay</button>
        <button className="dose-snooze" aria-label="Snooze for 10 minutes" disabled={disabled} onClick={() => onAction(idOf(dose), 'snooze')} title="Snooze 10 minutes"><Clock size={16} /></button>
        <button className="dose-skip" aria-label="Skip this dose" disabled={disabled} onClick={() => onAction(idOf(dose), 'skipped')} title="Skip dose"><X size={16} /></button>
      </div>
    </div>
  )
}

function AppointmentItem({ item }: { item: Row }) {
  const status = String(item.status ?? 'scheduled').toLowerCase()
  return (
    <div className="appointment-item">
      <div className="appointment-date"><CalendarDays size={19} /></div>
      <div><strong>{item.title ?? item.appointment_type ?? 'Appointment'}</strong>
        <span>{item.appointment_type === 'lab_test' ? 'Lab test' : 'Doctor appointment'}</span>
        <span className={`status-pill ${status === 'completed' ? 'status-done' : status === 'cancelled' ? 'status-muted' : 'status-pending'}`}>{status === 'completed' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Scheduled'}</span>
        <span>{dateLabel(item.appointment_date)} · {timeLabel(item.appointment_time)}</span>
        {item.location && <small>{item.location}</small>}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><Activity size={19} /><p>{text}</p></div>
}

function ResourceError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="resource-error" role="alert">
      <AlertCircle size={18} />
      <span>{text}</span>
      <button type="button" onClick={onRetry}>Retry</button>
    </div>
  )
}

function MedicalProfileSummary({ profile }: { profile: Row }) {
  const sections = [
    {
      title: 'Medical details',
      fields: [
        ['blood_group', 'Blood group'],
        ['allergies', 'Allergies'],
        ['medical_conditions', 'Medical conditions'],
      ],
    },
    {
      title: 'Physician',
      fields: [
        ['physician_name', 'Name'],
        ['physician_phone', 'Phone'],
        ['physician_address', 'Address'],
      ],
    },
    {
      title: 'Insurance',
      fields: [
        ['insurance_provider', 'Provider'],
        ['insurance_policy_number', 'Policy number'],
        ['insurance_member_id', 'Member ID'],
      ],
    },
  ] as const
  const hasDetails = sections.some(({ fields }) => fields.some(([key]) => profile[key] !== null && profile[key] !== undefined && String(profile[key]).trim() !== ''))

  return (
    <div className="medical-profile-summary" aria-label="Saved medical profile">
      <div className="saved-heading"><CheckCircle2 size={18} /><strong>Saved medical information</strong></div>
      {hasDetails ? sections.map(({ title, fields }) => {
        const populated = fields.filter(([key]) => profile[key] !== null && profile[key] !== undefined && String(profile[key]).trim() !== '')
        return populated.length ? (
          <section className="medical-summary-section" key={title}>
            <h4>{title}</h4>
            <div className="info-grid">
              {populated.map(([key, label]) => <InfoItem key={key} label={label} value={String(profile[key])} />)}
            </div>
          </section>
        ) : null
      }) : <p className="resource-loading">No medical details have been entered yet.</p>}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return <div className="info-item"><span>{label}</span><strong>{value}</strong></div>
}

export default App
