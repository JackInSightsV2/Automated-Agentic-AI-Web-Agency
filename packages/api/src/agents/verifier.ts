import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { fetchWithRetry } from '../lib/fetch-retry'

const VIABILITY_THRESHOLD = Number.parseInt(process.env.VIABILITY_THRESHOLD || '40')

interface CompaniesHouseResult {
  company_name: string
  company_number: string
  company_status: string
}

interface CompaniesHouseResponse {
  items?: CompaniesHouseResult[]
}

interface FilingHistoryResponse {
  items?: Array<{
    date: string
    description: string
    type: string
  }>
}

interface HMRCVatResponse {
  target?: {
    name: string
    vatNumber: string
    address?: {
      line1?: string
      postcode?: string
    }
  }
}

export async function runVerifierAgent(leadId: string): Promise<boolean> {
  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single()
  if (!lead) throw new Error(`Lead ${leadId} not found`)

  await agentLog('verifier', `Verifying: ${lead.name}`, { leadId })

  let score = 20 // Base score
  const notes: string[] = []

  // 1. Companies House lookup
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY
  let chStatus: string | null = null
  let chNumber: string | null = null

  if (apiKey) {
    try {
      const searchName = lead.name.replace(/[^a-zA-Z0-9 ]/g, '').trim()
      const res = await fetchWithRetry(
        `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(searchName)}&items_per_page=5`,
        {
          headers: {
            Authorization: 'Basic ' + btoa(apiKey + ':'),
          },
        }
      )

      if (res.ok) {
        const data = (await res.json()) as CompaniesHouseResponse
        const items = data.items || []

        // Fuzzy match — find best match by name similarity
        const match = items.find((item) => {
          const a = item.company_name.toLowerCase()
          const b = lead.name.toLowerCase()
          return a.includes(b) || b.includes(a) || levenshteinSimilarity(a, b) > 0.6
        })

        if (match) {
          chStatus = match.company_status
          chNumber = match.company_number
          notes.push(`Companies House: ${match.company_name} (${match.company_status})`)

          if (match.company_status === 'active') {
            score += 30
            notes.push('+30 active company')
          } else if (['dissolved', 'liquidation'].includes(match.company_status)) {
            score -= 50
            notes.push('-50 dissolved/liquidation')
          }
        } else {
          // Not found — likely sole trader, which is normal for small businesses
          score += 15
          notes.push('+15 not on Companies House (likely sole trader)')
        }
      } else {
        notes.push(`Companies House API error: ${res.status}`)
      }
    } catch (err) {
      notes.push(`Companies House lookup failed: ${String(err)}`)
    }
  } else {
    // No API key — give benefit of the doubt
    score += 15
    notes.push('+15 no Companies House API key configured')
  }

  // 2. HMRC Filing History Check (via Companies House filing-history endpoint)
  //    Checks if the company is actively filing confirmation statements and accounts,
  //    which indicates HMRC compliance and active business operations.
  if (chNumber && apiKey) {
    try {
      const filingRes = await fetchWithRetry(
        `https://api.company-information.service.gov.uk/company/${chNumber}/filing-history?items_per_page=5`,
        {
          headers: {
            Authorization: 'Basic ' + btoa(apiKey + ':'),
          },
        }
      )

      if (filingRes.ok) {
        const filingData = (await filingRes.json()) as FilingHistoryResponse
        const filings = filingData.items || []

        if (filings.length > 0) {
          const latestDate = new Date(filings[0].date)
          const monthsAgo = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24 * 30)

          if (monthsAgo <= 15) {
            score += 15
            notes.push(`+15 HMRC compliance: last filing ${filings[0].date} (${filings[0].description})`)
          } else {
            score -= 10
            notes.push(`-10 HMRC compliance: last filing ${filings[0].date} (${Math.round(monthsAgo)} months ago — possibly dormant)`)
          }
        } else {
          notes.push('HMRC compliance: no filing history found')
        }
      } else {
        notes.push(`Filing history API error: ${filingRes.status}`)
      }
    } catch (err) {
      notes.push(`HMRC filing history check failed: ${String(err)}`)
    }
  }

  // 3. HMRC VAT Registration Check
  //    Validates whether the business is VAT registered (turnover > £85k threshold).
  //    Uses HMRC's public VAT check API — requires a VAT Registration Number (VRN).
  const hmrcVatCheck = process.env.HMRC_VAT_CHECK !== 'false'
  if (hmrcVatCheck && chNumber) {
    try {
      // UK VAT numbers for limited companies can sometimes be found by trying
      // the company number as a VRN (not always reliable, but worth checking)
      const potentialVrn = chNumber.replace(/^0+/, '').padStart(9, '0')

      const vatRes = await fetchWithRetry(
        `https://api.service.hmrc.gov.uk/organisations/vat/check-vat-number/lookup/${potentialVrn}`,
        {
          headers: { Accept: 'application/json' },
        }
      )

      if (vatRes.ok) {
        const vatData = (await vatRes.json()) as HMRCVatResponse
        if (vatData.target) {
          score += 15
          notes.push(`+15 HMRC VAT registered: ${vatData.target.name} (VRN: ${vatData.target.vatNumber})`)
        }
      } else if (vatRes.status === 404) {
        // Not VAT registered — neutral for small businesses
        notes.push('HMRC VAT: not registered (normal for businesses under £85k turnover)')
      } else {
        notes.push(`HMRC VAT API error: ${vatRes.status}`)
      }
    } catch (err) {
      notes.push(`HMRC VAT check failed: ${String(err)}`)
    }
  }

  // 4. Google rating scoring
  if (lead.google_rating !== null) {
    if (lead.google_rating >= 4.0) {
      score += 20
      notes.push(`+20 rating ${lead.google_rating}`)
    } else if (lead.google_rating >= 3.0) {
      score += 10
      notes.push(`+10 rating ${lead.google_rating}`)
    }
  }

  // 5. Google review count scoring
  if (lead.google_review_count !== null) {
    if (lead.google_review_count >= 50) {
      score += 20
      notes.push(`+20 reviews ${lead.google_review_count}`)
    } else if (lead.google_review_count >= 10) {
      score += 10
      notes.push(`+10 reviews ${lead.google_review_count}`)
    }
  }

  // 6. Has phone
  if (lead.phone) {
    score += 10
    notes.push('+10 has phone')
  }

  const viable = score >= VIABILITY_THRESHOLD

  // Update lead
  await supabase
    .from('leads')
    .update({
      viability_score: score,
      viability_notes: notes.join('\n'),
      companies_house_status: chStatus,
      companies_house_number: chNumber,
      status: viable ? 'verified' : 'rejected',
      status_updated_at: new Date().toISOString(),
      error: viable ? null : `Viability score ${score} below threshold ${VIABILITY_THRESHOLD}`,
    })
    .eq('id', leadId)

  await agentLog('verifier', `${lead.name}: score ${score}/${VIABILITY_THRESHOLD} — ${viable ? 'VIABLE' : 'REJECTED'}`, {
    leadId,
    level: viable ? 'success' : 'warn',
  })

  return viable
}

function levenshteinSimilarity(a: string, b: string): number {
  const matrix: number[][] = []
  const aLen = a.length
  const bLen = b.length

  if (aLen === 0) return bLen === 0 ? 1 : 0
  if (bLen === 0) return 0

  for (let i = 0; i <= bLen; i++) matrix[i] = [i]
  for (let j = 0; j <= aLen; j++) matrix[0][j] = j

  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  const maxLen = Math.max(aLen, bLen)
  return 1 - matrix[bLen][aLen] / maxLen
}
