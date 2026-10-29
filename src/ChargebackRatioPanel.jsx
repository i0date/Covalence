// ═══════════════════════════════════════════════════════════════════════════════
// CHARGEBACK RATIO PANEL — Home and Desk (merchant side) show the same figures
// ═══════════════════════════════════════════════════════════════════════════════
// Per network, the last 30 days against the monitoring thresholds in Settings
// (chargebackRatio.mjs). Demo visitors who haven't entered sales see sample ones.
import React from 'react'
import { chargebackRatios } from './chargebackRatio.mjs'

export const ratioPct = r => r.ratio == null ? '—' : r.ratio.toFixed(2) + '%'
const TONE = { over:'#991B1B', over_ratio:'#92400E', approaching:'#92400E', ok:'#065F46', unknown:'#78716C' }
const say = r => ({
  unknown: `Add your monthly ${r.label} sales in Settings → Chargebacks against you to see this.`,
  ok: `Within ${r.label}’s ${r.limit}% threshold. Covalence warns from ${r.warnAt.toFixed(1)}%.`,
  approaching: `Approaching ${r.label}’s ${r.limit}% threshold. Look at the reason codes driving it in 003 Multi.`,
  over_ratio: `Above ${r.limit}%, but under the ${r.minCount.toLocaleString('en-US')} chargebacks ${r.label} ${r.program} needs before it enrols a merchant. Your acquirer may still act on it.`,
  over: `Above ${r.label}’s threshold with enough volume to be enrolled in ${r.program}. Talk to your acquirer now — fines and higher fees follow.`,
})[r.state]

export function ratiosFor(cases, settings, covUser) {
  const demoSales = !!covUser?.demo && !covUser?.authed && !settings?.mchMonthlyTxVisa && !settings?.mchMonthlyTxMc
  return { demoSales, ratios: chargebackRatios(cases, demoSales ? { ...settings, mchMonthlyTxVisa: 900, mchMonthlyTxMc: 300 } : settings) }
}

// attached: sits directly under Home's number strip (no top border)
export function ChargebackRatioPanel({ ratios, demoSales, attached = false }) {
  return (
    <section aria-label="Chargeback ratio" style={{ border:'1px solid #D4CCBC', borderTop: attached ? 'none' : '1px solid #D4CCBC', background:'#FFFFFF', padding:'14px 18px' }}>
      <div className="mono-font" style={{ fontSize:'10px', letterSpacing:'0.15em', color:'#78716C', marginBottom:'10px' }}>CHARGEBACK RATIO · LAST 30 DAYS{demoSales ? ' · DEMO SALES FIGURES' : ''}</div>
      <div style={{ display:'grid', gap:'14px' }}>
        {ratios.map(r => (
          <div key={r.key}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:'10px', flexWrap:'wrap', alignItems:'baseline' }}>
              <span className="display-font" style={{ fontSize:'15px', color:'#1A1814' }}>{r.label} <span className="mono-font" style={{ fontSize:'10px', color:'#78716C' }}>{r.program}</span></span>
              <span className="mono-font" style={{ fontSize:'12px', fontWeight:600, color: TONE[r.state] }}>{ratioPct(r)} <span style={{ fontWeight:400, color:'#78716C' }}>· {r.count} chargeback{r.count === 1 ? '' : 's'}{r.sales ? ` on ${r.sales.toLocaleString('en-US')} sales` : ''}</span></span>
            </div>
            {r.ratio != null && (
              <div role="img" aria-label={`${r.label} ratio ${ratioPct(r)} against a ${r.limit}% threshold`} style={{ position:'relative', height:'6px', background:'#EDE8E0', marginTop:'6px' }}>
                <div style={{ position:'absolute', inset:'0 auto 0 0', width: Math.min(100, r.ratio / (r.limit * 1.5) * 100) + '%', background: TONE[r.state] }} />
                <div title={`${r.limit}% threshold`} style={{ position:'absolute', top:'-3px', bottom:'-3px', left: (100 / 1.5) + '%', width:'2px', background:'#1A1814' }} />
              </div>
            )}
            <div className="display-font" style={{ fontSize:'12px', color:'#57534E', marginTop:'4px' }}>{say(r)}</div>
          </div>
        ))}
      </div>
      <p className="display-font" style={{ fontSize:'11px', color:'#78716C', margin:'12px 0 0', lineHeight:1.5 }}>
        Every chargeback counts, including ones you win. Visa also counts fraud reports that never became chargebacks, which Covalence doesn’t see, so Visa’s own figure can be higher. Thresholds are settings; your acquirer’s terms are what apply.
      </p>
    </section>
  )
}
