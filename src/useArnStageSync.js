// A case linked by ARN with stage sharing on (LinkedCases.jsx) tells the other side
// when its status changes, wherever in the app the change happened.
import { useEffect, useRef } from 'react'
import { arnPublishStage } from './data.js'

export function useArnStageSync(outcomes, setOutcomes) {
  const inFlight = useRef(new Set())
  useEffect(() => {
    (outcomes || []).filter(c => c.arnLink?.session && c.arnLink.sync && (c.status || '') !== (c.arnLink.published || '')).forEach(c => {
      const key = c.id + ':' + c.status
      if (inFlight.current.has(key)) return
      inFlight.current.add(key)
      arnPublishStage(c.arnLink.session, c.status || '', true)
        .then(() => setOutcomes(prev => prev.map(o => o.id === c.id && o.arnLink ? { ...o, arnLink: { ...o.arnLink, published: c.status || '' } } : o)))
        .catch(() => {})
        .finally(() => inFlight.current.delete(key))
    })
  }, [outcomes])
}
