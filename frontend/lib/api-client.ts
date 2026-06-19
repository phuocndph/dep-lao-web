import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './auth'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const instance: AxiosInstance = axios.create({ baseURL: BASE_URL })

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

instance.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original: AxiosRequestConfig & { _retry?: boolean } = error.config

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const refreshToken = getRefreshToken()
      if (!refreshToken) {
        clearTokens()
        if (typeof window !== 'undefined') window.location.href = '/login'
        return Promise.reject(error)
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            if (original.headers) original.headers['Authorization'] = `Bearer ${token}`
            resolve(instance(original))
          })
        })
      }

      isRefreshing = true
      try {
        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken })
        const { accessToken, refreshToken: newRefresh } = res.data
        setTokens(accessToken, newRefresh)
        refreshQueue.forEach((cb) => cb(accessToken))
        refreshQueue = []
        if (original.headers) original.headers['Authorization'] = `Bearer ${accessToken}`
        return instance(original)
      } catch {
        clearTokens()
        if (typeof window !== 'undefined') window.location.href = '/login'
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)

const apiClient = {
  get<T>(url: string): Promise<T> {
    return instance.get<T>(url).then((r) => r.data)
  },
  post<T>(url: string, data?: unknown): Promise<T> {
    return instance.post<T>(url, data).then((r) => r.data)
  },
  put<T>(url: string, data?: unknown): Promise<T> {
    return instance.put<T>(url, data).then((r) => r.data)
  },
  del<T>(url: string): Promise<T> {
    return instance.delete<T>(url).then((r) => r.data)
  },
}

export default apiClient
