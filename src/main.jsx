import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import Covalence from './Covalence.jsx'
import CaseViewer from './CaseViewer.jsx'
import AiPage from './AiPage.jsx'
import DevelopersPage from './DevelopersPage.jsx'
import { initCaseStore } from './caseStore.js'

const caseToken = new URLSearchParams(window.location.search).get('case')
const path = window.location.pathname.replace(/\/+$/, '')
const aiPage = path === '/ai'                 // public: how Covalence uses AI
const devPage = path === '/developers'       // public: how to connect your systems

// Cases load from IndexedDB first, so the tools (and demo seeding) can read them synchronously
initCaseStore().finally(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {aiPage ? <AiPage /> : devPage ? <DevelopersPage /> : caseToken ? <CaseViewer token={caseToken} /> : <Covalence />}
    <Analytics />
  </React.StrictMode>
))
