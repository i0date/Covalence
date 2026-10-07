import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import Covalence from './Covalence.jsx'
import CaseViewer from './CaseViewer.jsx'

const caseToken = new URLSearchParams(window.location.search).get('case')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {caseToken ? <CaseViewer token={caseToken} /> : <Covalence />}
    <Analytics />
  </React.StrictMode>
)
