import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
