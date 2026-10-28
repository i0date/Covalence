import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import Covalence from './Covalence.jsx'
import CaseViewer from './CaseViewer.jsx'
import AiPage from './AiPage.jsx'
import { initCaseStore } from './caseStore.js'

const caseToken = new URLSearchParams(window.location.search).get('case')
const aiPage = window.location.pathname.replace(/\/+$/, '') === '/ai'   // public: how Covalence uses AI

// Cases load from IndexedDB first, so the tools (and demo seeding) can read them synchronously
initCaseStore().finally(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {aiPage ? <AiPage /> : caseToken ? <CaseViewer token={caseToken} /> : <Covalence />}
    <Analytics />
  </React.StrictMode>
))
