import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

import { Capacitor } from '@capacitor/core'

// تطبيق الأندرويد بيستقبل الإشعارات من Firebase مباشرة، فمش محتاج Service Worker
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
