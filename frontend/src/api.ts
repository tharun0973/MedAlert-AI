import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('medalert_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('medalert_token')
      sessionStorage.removeItem('medalert_role')
      window.dispatchEvent(new Event('medalert:unauthorized'))
    }
    return Promise.reject(error)
  },
)

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const detail = error.response?.data?.detail
    const text = typeof detail === 'string' ? detail.toLowerCase() : ''
    if (status === 401) return 'Your session has expired. Please sign in again.'
    if (status === 403) return 'You do not have permission to access or change this information.'
    if (status === 404) return 'This record is no longer available. Refresh the page and try again.'
    if (status === 409 && text.includes('dose history')) return 'Reminder times cannot be changed after dose history is recorded. Keep the current times.'
    if (status === 409 && text.includes('already exists')) return 'A record with these details already exists.'
    if (status === 409) return 'This change conflicts with a saved record. Refresh and try again.'
    if (status === 400) return 'Please check the information and try again.'
    if (status === 422) return 'Some information is missing or invalid. Check the form and try again.'
    if (status && status >= 500) return 'The server could not save this change. Please try again shortly.'
    if (!error.response) return 'The server could not be reached. Check your connection and try again.'
    return error.message || 'The request could not be completed.'
  }

  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function errorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined
}
