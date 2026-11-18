import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity, AlertCircle, AlertTriangle, CalendarDays, Check,
  CheckCircle2, Clock, Heart, Home, LogOut, Menu, Pill,
  ShieldAlert, UserRound, Users, X,
} from 'lucide-react'
import { api, errorMessage } from './api'
import './App.css'

type Page = 'overview' | 'medications' | 'appointments' | 'checkins' | 'emergency'

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
] as const

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
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeLabel(value?: string): string {
  if (!value) return 'Time not set'
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

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [registerMode, setRegisterMode] = useState(false)

  const [patient, setPatient] = useState<Row | null>(null)
  const [medications, setMedications] = useState<Row[]>([])
  const [schedules, setSchedules] = useState<Row[]>([])

  const [medName, setMedName] = useState('')
  const [medDosage, setMedDosage] = useState('')
  const [medFrequency, setMedFrequency] = useState('Once daily')
  const [medTimes, setMedTimes] = useState('09:00')
  const [medFoodInstructions, setMedFoodInstructions] = useState('')
  const [medCritical, setMedCritical] = useState(false)
  const [medGracePeriod, setMedGracePeriod] = useState('30')

  const [appointmentTitle, setAppointmentTitle] = useState('')
  const [appointmentType, setAppointmentType] = useState('appointment')
  const [appointmentDate, setAppointmentDate] = useState('')
  const [appointmentTime, setAppointmentTime] = useState('')
  const [appointmentLocation, setAppointmentLocation] = useState('')
  const [appointmentNotes, setAppointmentNotes] = useState('')

  const [doses, setDoses] = useState<Row[]>([])
  const [appointments, setAppointments] = useState<Row[]>([])
  const [checkins, setCheckins] = useState<Row[]>([])
  const [contacts, setContacts] = useState<Row[]>([])
  const [medicalProfile, setMedicalProfile] = useState<Row | null>(null)

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
    setMedicalProfile(null)
    setAlerts([])
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
        const medicationResponse = await api.get(`/patients/${resolvedPatientId}/medications`)
        const medicationRows = rows(medicationResponse.data)
        setMedications(medicationRows)

        const scheduleResults = await Promise.allSettled(
          medicationRows.map((medication) =>
            api.get(`/medications/${idOf(medication)}/schedules`),
          ),
        )

        const allSchedules = scheduleResults.flatMap((result) =>
          result.status === 'fulfilled' ? rows(result.value.data) : [],
        )
        setSchedules(allSchedules)

        const [doseResult, appointmentResult, checkinResult, contactResult, profileResult] =
          await Promise.allSettled([
            api.get('/medication-doses'),
            api.get(`/patients/${resolvedPatientId}/appointments`),
            api.get(`/patients/${resolvedPatientId}/wellness-checkins`),
            api.get(`/patients/${resolvedPatientId}/emergency-contacts`),
            api.get(`/patients/${resolvedPatientId}/medical-profile`),
          ])

        setDoses(doseResult.status === 'fulfilled' ? rows(doseResult.value.data) : [])
        setAppointments(appointmentResult.status === 'fulfilled' ? rows(appointmentResult.value.data) : [])
        setCheckins(checkinResult.status === 'fulfilled' ? rows(checkinResult.value.data) : [])
        setContacts(contactResult.status === 'fulfilled' ? rows(contactResult.value.data) : [])
        setMedicalProfile(profileResult.status === 'fulfilled' ? rows(profileResult.value.data)[0] ?? null : null)
      }

      if (currentAccount.role === 'caregiver') {
        try {
          const alertResponse = await api.get('/caregiver-alerts')
          setAlerts(rows(alertResponse.data))
        } catch {
          setAlerts([])
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
    if (account) await loadDashboard(account)
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
      const patientResponse = await api.post('/patients', {
        full_name: fullName,
        email,
      })

      const newPatient = patientResponse.data
      const newPatientId = Number(newPatient.id ?? newPatient.patient_id)

      if (!newPatientId) {
        throw new Error('Patient profile was created, but its ID was not returned.')
      }

      await api.post('/auth/register', {
        email,
        password,
        role: 'senior',
        patient_id: newPatientId,
      })

      setRegisterMode(false)
      setNotice('Registration successful. Please log in.')
      setPassword('')
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

    setError('')
    setNotice('')
    setBusy(true)

    try {
      const response = await api.post(`/patients/${patientId}/medications`, {
        name: medName.trim(),
        dosage: medDosage.trim(),
        frequency: medFrequency.trim(),
        reminder_time: times[0],
        is_critical: medCritical,
        grace_period_minutes: Number(medGracePeriod),
        food_instructions: medFoodInstructions.trim() || null,
      })

      const medicationId = Number(response.data.medication_id ?? response.data.id)
      if (!medicationId) throw new Error('Medication ID was not returned.')

      for (const reminderTime of times) {
        await api.post(`/medications/${medicationId}/schedules`, {
          reminder_time: reminderTime,
        })
      }

      setMedName('')
      setMedDosage('')
      setMedFrequency('Once daily')
      setMedTimes('09:00')
      setMedFoodInstructions('')
      setMedCritical(false)
      setMedGracePeriod('30')
      setNotice('Medication and reminder schedule added successfully.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
      await refresh()
    } finally {
      setBusy(false)
    }
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
      await api.post('/appointments', {
        patient_id: patientId,
        title: appointmentTitle.trim(),
        appointment_type: appointmentType,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime || null,
        location: appointmentLocation.trim() || null,
        notes: appointmentNotes.trim() || null,
      })

      setAppointmentTitle('')
      setAppointmentType('appointment')
      setAppointmentDate('')
      setAppointmentTime('')
      setAppointmentLocation('')
      setAppointmentNotes('')
      setNotice('Appointment added successfully.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleDoseAction = async (doseId: number, action: 'taken' | 'skipped' | 'snooze') => {
    setError('')
    setNotice('')

    try {
      if (action === 'snooze') {
        await api.post(`/medication-doses/${doseId}/snooze?snooze_minutes=10`)
        setNotice('Dose reminder snoozed for 10 minutes.')
      } else {
        await api.post(`/medication-doses/${doseId}/${action}`)
        setNotice(action === 'taken' ? 'Medication marked as taken.' : 'Medication marked as skipped.')
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
    setBusy(true)

    try {
      await api.post('/emergency-contacts', {
        patient_id: patientId,
        full_name: contactName.trim(),
        relationship: contactRelationship.trim() || null,
        phone: contactPhone.trim(),
        email: contactEmail.trim() || null,
        is_primary: contactPrimary,
        receives_emergency_alerts: contactReceivesAlerts,
      })

      setContactName('')
      setContactRelationship('')
      setContactPhone('')
      setContactEmail('')
      setContactPrimary(false)
      setContactReceivesAlerts(true)
      setNotice('Emergency contact added successfully.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSaveMedicalProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!patientId) return

    setError('')
    setNotice('')
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

      await api.post('/medical-profile', payload)
      setNotice('Medical profile saved successfully.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const triggerEmergency = async () => {
    if (!patientId) return
    const confirmed = window.confirm(
      'Trigger an emergency alert for this patient? This records an alert in MedAlert AI but does not guarantee that emergency services will be contacted.',
    )
    if (!confirmed) return

    setError('')
    setNotice('')

    try {
      await api.post('/emergency/trigger', {
        patient_id: patientId,
        message: 'Emergency assistance requested through MedAlert AI.',
      })
      setNotice('Emergency alert recorded. Contact emergency services directly if immediate help is needed.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
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

          <h2>{registerMode ? 'Create your account' : 'Welcome back'}</h2>
          <p className="auth-subtitle">
            {registerMode
              ? 'Register as a senior patient to get started.'
              : 'Sign in to access your care dashboard.'}
          </p>

          {error && <div className="notice error"><AlertCircle size={17} />{error}</div>}
          {notice && <div className="notice success"><CheckCircle2 size={17} />{notice}</div>}

          <form onSubmit={registerMode ? handleRegister : handleLogin} className="auth-form">
            {registerMode && (
              <label>
                Full name
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </label>
            )}
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
              setError('')
              setNotice('')
            }}
          >
            {registerMode ? 'Already have an account? Sign in' : 'New senior patient? Create an account'}
          </button>

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
        <StatCard icon={<Pill />} label="Medications" value={medications.length} detail="Registered medications" />
        <StatCard icon={<Clock />} label="Pending doses" value={pendingDoses.length} detail="Awaiting action" />
        <StatCard icon={<CalendarDays />} label="Appointments" value={appointments.length} detail="Scheduled records" />
        <StatCard icon={<Heart />} label="Wellness check-ins" value={checkins.length} detail="Recorded check-ins" />
      </div>

      {account.role === 'caregiver' && (
        <section className="panel">
          <div className="panel-heading">
            <div><h3>Caregiver alerts</h3><p>Alerts associated with your linked patient.</p></div>
            <Users size={21} />
          </div>
          {alerts.length === 0 ? <EmptyState text="No caregiver alerts are currently available." /> :
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
          {pendingDoses.length === 0 ? <EmptyState text="No pending medication doses were returned by the backend." /> :
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
          {appointments.length === 0 ? <EmptyState text="No appointment records found." /> :
            appointments.slice(0, 4).map((item) => <AppointmentItem key={idOf(item)} item={item} />)}
          <button className="text-button" onClick={() => setPage('appointments')}>View appointments</button>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div><h3>Care information</h3><p>Information currently available from your profile.</p></div>
          <UserRound size={21} />
        </div>
        <div className="info-grid">
          <InfoItem label="Patient" value={displayName} />
          <InfoItem label="Email" value={patient?.email ?? account.email} />
          <InfoItem label="Emergency contacts" value={String(contacts.length)} />
          <InfoItem label="Medical profile" value={medicalProfile ? 'Available' : 'Not added'} />
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

      {account.role === 'senior' && (
        <form className="medication-form" onSubmit={handleAddMedication}>
          <div className="medication-form-heading">
            <div>
              <h3>Add a medication</h3>
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
              <input value={medFrequency} onChange={(e) => setMedFrequency(e.target.value)} required placeholder="e.g. Once daily" />
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
          </div>

          <div className="medication-form-footer">
            <label className="medication-critical">
              <input type="checkbox" checked={medCritical} onChange={(e) => setMedCritical(e.target.checked)} />
              <span>
                <strong>Critical medication</strong>
                <small>Mark if this medication is especially important.</small>
              </span>
            </label>

            <button className="medication-save-button" type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save medication and reminders'}
            </button>
          </div>
        </form>
      )}
      {medications.length === 0 && <EmptyState text="No medication records were found for this patient." />}

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
            {medication.food_instructions && <p className="muted-text">{medication.food_instructions}</p>}
            <p className="muted-text">{medication.is_critical ? 'Critical medication' : 'Standard medication'}</p>
            <div className="schedule-list">
              {medicationSchedules.length === 0 ? <p>No schedule records found.</p> :
                medicationSchedules.map((schedule) => (
                  <span key={idOf(schedule)}><Clock size={14} /> {timeLabel(schedule.reminder_time)}</span>
                ))}
            </div>
          </div>
        )
      })}

      <div className="panel-heading dose-heading"><div><h3>Dose actions</h3><p>Actions are available for pending doses.</p></div></div>
      {pendingDoses.length === 0 ? <EmptyState text="There are no pending doses." /> :
        pendingDoses.map((dose) => (
          <MedicationRow key={idOf(dose)} dose={dose} onAction={handleDoseAction} disabled={account.role !== 'senior'} />
        ))}
      {account.role === 'caregiver' && <p className="muted-text">Caregiver accounts can view information but cannot record medication actions.</p>}
    </section>
  )

  const renderAppointments = () => (
    <section className="page-panel">
      <div className="page-heading">
        <div><h2>Appointments</h2><p>Appointments and lab test records from your account.</p></div>
        <CalendarDays size={25} />
      </div>
      {account.role === 'senior' && (
        <form className="medication-form" onSubmit={handleAddAppointment}>
          <div className="medication-form-heading">
            <div>
              <h3>Add an appointment</h3>
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
            <span className="muted-text">You can update your appointment details later.</span>
            <button className="medication-save-button" type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save appointment'}
            </button>
          </div>
        </form>
      )}

      {appointments.length === 0 ? <EmptyState text="No appointments have been recorded." /> :
        appointments.map((item) => <AppointmentItem key={idOf(item)} item={item} />)}
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
          {checkins.length === 0 ? (
            <EmptyState text="No wellness check-in records were found." />
          ) : (
            checkins.map((item) => {
              const completed =
                String(item.status ?? '').toLowerCase() === 'checked_in'

              return (
                <div className="record-row" key={idOf(item)}>
                  <div>
                    <strong>{dateLabel(item.checkin_date)}</strong>
                    <p>Due at {timeLabel(item.due_time)}</p>
                  </div>
                  <span className={`status-pill ${completed ? 'status-done' : 'status-pending'}`}>
                    {completed ? 'Checked in' : 'Pending'}
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

      <div className="emergency-section">
        <h3>Emergency contacts</h3>
        <p className="muted-text">People who can be contacted if you need assistance.</p>

        {contacts.length === 0 ? (
          <EmptyState text="No emergency contacts have been added." />
        ) : contacts.map((contact) => (
          <div className="record-row" key={idOf(contact)}>
            <div>
              <strong>{contact.full_name}</strong>
              <p>
                {contact.relationship || 'Contact'}
                {' · '}
                {contact.phone}
              </p>
              {contact.email && <p>{contact.email}</p>}
              <div className="contact-tags">
                {contact.is_primary && <span className="status-pill status-done">Primary contact</span>}
                {contact.receives_emergency_alerts && <span className="status-pill status-pending">Emergency alerts enabled</span>}
              </div>
            </div>
            <UserRound size={22} />
          </div>
        ))}

        {account.role === 'senior' && (
          <form className="medication-form" onSubmit={handleAddEmergencyContact}>
            <div className="medication-form-heading">
              <div>
                <h3>Add emergency contact</h3>
                <p>Enter the details of someone who can help you.</p>
              </div>
              <div className="medication-form-icon"><Users size={22} /></div>
            </div>

            <div className="medication-form-grid">
              <label className="medication-field">
                <span>Full name</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} required maxLength={150} placeholder="Contact name" />
              </label>

              <label className="medication-field">
                <span>Relationship</span>
                <input value={contactRelationship} onChange={(e) => setContactRelationship(e.target.value)} placeholder="e.g. Son, Daughter, Friend" />
              </label>

              <label className="medication-field">
                <span>Phone number</span>
                <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} required placeholder="Phone number" />
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

            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save emergency contact'}
            </button>
          </form>
        )}
      </div>

      <div className="emergency-section">
        <h3>Medical profile</h3>
        <p className="muted-text">Important medical information for your care.</p>

        {account.role === 'senior' ? (
          <form className="medication-form" onSubmit={handleSaveMedicalProfile}>
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

            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save medical profile'}
            </button>
          </form>
        ) : (
          !medicalProfile ? (
            <EmptyState text="No medical profile has been added." />
          ) : (
            <div className="info-grid">
              {Object.entries(medicalProfile)
                .filter(([key, value]) => !['id', 'patient_id', 'updated_at'].includes(key) && value !== null && value !== '')
                .map(([key, value]) => <InfoItem key={key} label={key.replaceAll('_', ' ')} value={String(value)} />)}
            </div>
          )
        )}
      </div>
    </section>
  )

  const pageContent = {
    overview: renderOverview,
    medications: renderMedications,
    appointments: renderAppointments,
    checkins: renderCheckins,
    emergency: renderEmergency,
  }[page]()

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-icon"><Heart size={22} /></div>
          <div><strong>MedAlert AI</strong><span>Care dashboard</span></div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X /></button>
        </div>

        <div className="sidebar-profile">
          <div className="avatar"><UserRound size={21} /></div>
          <div><strong>{displayName}</strong><span>{account.role}</span></div>
        </div>

        <nav className="navigation">
          <span className="nav-caption">MENU</span>
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

        <button className="logout-button" onClick={logout}><LogOut size={18} /> Sign out</button>
      </aside>

      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu /></button>
          <div><span className="topbar-label">MEDALERT AI</span><h1>{navigation.find((item) => item.id === page)?.label}</h1></div>
          <button className="refresh-button" onClick={() => void refresh()} disabled={loading}>
            <Activity size={17} /> Refresh
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

function StatCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: number; detail: string }) {
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
  onAction: (id: number, action: 'taken' | 'skipped' | 'snooze') => void
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
        <button className="dose-taken" disabled={disabled} onClick={() => onAction(idOf(dose), 'taken')} title="Mark taken"><Check size={16} /></button>
        <button className="dose-snooze" disabled={disabled} onClick={() => onAction(idOf(dose), 'snooze')} title="Snooze 10 minutes"><Clock size={16} /></button>
        <button className="dose-skip" disabled={disabled} onClick={() => onAction(idOf(dose), 'skipped')} title="Skip dose"><X size={16} /></button>
      </div>
    </div>
  )
}

function AppointmentItem({ item }: { item: Row }) {
  return (
    <div className="appointment-item">
      <div className="appointment-date"><CalendarDays size={19} /></div>
      <div><strong>{item.title ?? item.appointment_type ?? 'Appointment'}</strong>
        <span>{dateLabel(item.appointment_date)} · {timeLabel(item.appointment_time)}</span>
        {item.location && <small>{item.location}</small>}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><Activity size={19} /><p>{text}</p></div>
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return <div className="info-item"><span>{label}</span><strong>{value}</strong></div>
}

export default App
