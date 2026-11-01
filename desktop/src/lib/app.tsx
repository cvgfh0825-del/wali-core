import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { Backend, Profile, Row } from './backend'

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string }

type Ctx = {
  db: Backend
  me: Profile
  settings: Row
  rate: number | null
  latestRate: number | null
  can: (module: string, action?: string) => boolean
  isAdmin: boolean
  reloadRate: () => Promise<void>
  reloadSettings: () => Promise<void>
  toast: (text: string, kind?: Toast['kind']) => void
  signOut: () => void
}

const AppCtx = createContext<Ctx>(null as any)
export const useApp = () => useContext(AppCtx)

const ToastCtx = createContext<{ toasts: Toast[]; push: (t: string, k?: Toast['kind']) => void }>(null as any)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : kind === 'info' ? 1800 : 3500)
  }, [])
  return <ToastCtx.Provider value={{ toasts, push }}>{children}</ToastCtx.Provider>
}
export const useToasts = () => useContext(ToastCtx)

export function AppProvider({ db, me, onSignOut, children }: { db: Backend; me: Profile; onSignOut: () => void; children: ReactNode }) {
  const { push } = useToasts()
  const [settings, setSettings] = useState<Row>({})
  const [rate, setRate] = useState<number | null>(null)
  const [latestRate, setLatest] = useState<number | null>(null)
  const [ready, setReady] = useState(false)

  const reloadRate = useCallback(async () => {
    const [r, l] = await Promise.all([db.rpc<number | null>('current_rate'), db.rpc<number | null>('latest_rate')])
    setRate(r == null ? null : Number(r))
    setLatest(l == null ? null : Number(l))
  }, [db])
  const reloadSettings = useCallback(async () => {
    setSettings((await db.get('settings', 1)) ?? {})
  }, [db])

  useEffect(() => {
    if (import.meta.env.DEV) (window as any).__db = db
    Promise.all([reloadRate(), reloadSettings()]).finally(() => setReady(true))
    return db.subscribe('exchange_rates', () => reloadRate())
  }, [db, reloadRate, reloadSettings])

  const isAdmin = me.role === 'admin'
  const can = useCallback(
    (m: string, a = 'view') => isAdmin || (me.permissions?.[m] ?? []).includes(a),
    [isAdmin, me.permissions])

  // نسخة احتياطية تلقائية مرة في اليوم (بعد ما البرنامج يفتح بشوية عشان ميبطّأش الدخول)
  useEffect(() => {
    if (!isAdmin) return
    const t = setTimeout(() => import('./backup').then((m) => m.autoBackupIfDue(db)), 8000)
    return () => clearTimeout(t)
  }, [db, isAdmin])

  if (!ready) return null
  return (
    <AppCtx.Provider value={{ db, me, settings, rate, latestRate, can, isAdmin, reloadRate, reloadSettings, toast: push, signOut: onSignOut }}>
      {children}
    </AppCtx.Provider>
  )
}

// تحميل بيانات مع إعادة التحميل التلقائي لما الجداول تتغير
export function useLoad<T>(fn: () => Promise<T>, deps: any[], tables: string[] = []) {
  const { db, toast } = useApp()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current())
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }, [toast])
  useEffect(() => {
    setLoading(true)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    let t: any
    const offs = tables.map((tb) => db.subscribe(tb, () => { clearTimeout(t); t = setTimeout(reload, 250) }))
    return () => { clearTimeout(t); offs.forEach((o) => o()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, reload, tables.join(',')])
  return { data, loading, reload, setData }
}

// تشغيل عملية مع رسالة نجاح أو خطأ
export function useAction() {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true)
    try {
      const r = await fn()
      if (ok) toast(ok, 'ok')
      return r
    } catch (e: any) {
      toast(e.message ?? String(e), 'err')
      return undefined
    } finally {
      setBusy(false)
    }
  }, [toast])
  return { busy, run }
}
