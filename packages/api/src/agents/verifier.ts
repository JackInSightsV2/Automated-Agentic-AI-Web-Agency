import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'

const VIABILITY_THRESHOLD = parseInt(process.env.VIABILITY_THRESHOLD || '40')

interface CompaniesHouseResult {
  company_name: string
  company_number: string
  company_status: string
}

interface CompaniesHouseResponse {
  items?: CompaniesHouseResult[]
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
      const res = await fetch(
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

  // 2. Google rating scoring
  if (lead.google_rating !== null) {
    if (lead.google_rating >= 4.0) {
      score += 20
      notes.push(`+20 rating ${lead.google_rating}`)
    } else if (lead.google_rating >= 3.0) {
      score += 10
      notes.push(`+10 rating ${lead.google_rating}`)
    }
  }

  // 3. Google review count scoring
  if (lead.google_review_count !== null) {
    if (lead.google_review_count >= 50) {
      score += 20
      notes.push(`+20 reviews ${lead.google_review_count}`)
    } else if (lead.google_review_count >= 10) {
      score += 10
      notes.push(`+10 reviews ${lead.google_review_count}`)
    }
  }

  // 4. Has phone
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
