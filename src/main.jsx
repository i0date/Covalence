import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import Covalence from './Covalence.jsx'
import CaseViewer from './CaseViewer.jsx'
import AiPage from './AiPage.jsx'
import DevelopersPage from './DevelopersPage.jsx'
import ClaimFormPage from './ClaimFormPage.jsx'
import { initCaseStore } from './caseStore.js'

const caseToken = new URLSearchParams(window.location.search).get('case')
const path = window.location.pathname.replace(/\/+$/, '')
const aiPage = path === '/ai'                 // public: how Covalence uses AI
const devPage = path === '/developers'       // public: how to connect your systems
const claimToken = path.match(/^\/claim\/([A-Za-z0-9_]{4,80})$/)?.[1]   // public: the hosted claim form, opened by its link

// Cases load from IndexedDB first, so the tools (and demo seeding) can read them synchronously
initCaseStore().finally(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {claimToken ? <ClaimFormPage token={claimToken} /> : aiPage ? <AiPage /> : devPage ? <DevelopersPage /> : caseToken ? <CaseViewer token={caseToken} /> : <Covalence />}
    {!claimToken && <Analytics />}{/* a claim link is a key: it stays out of analytics */}
  </React.StrictMode>
))
