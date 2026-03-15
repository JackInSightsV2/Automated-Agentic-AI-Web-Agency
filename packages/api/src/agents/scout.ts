import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'

interface Place {
  id: string
  displayName: { text: string }
  formattedAddress: string
  nationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  types?: string[]
}

async function runMockScout(query: string, pipelineRunId: string, limit = 3): Promise<string[]> {
  await agentLog('scout', `[MOCK] Searching: ${query}`, { runId: pipelineRunId })

  const mockData = await import('../data/mock-places.json')
  let places: Place[] = mockData.places || []

  // Filter by query terms
  const terms = query.toLowerCase().split(' ')
  places = places.filter((p) => {
    const text = `${p.displayName.text} ${p.formattedAddress} ${(p.types || []).join(' ')}`.toLowerCase()
    return terms.some((t) => text.includes(t))
  })

  // If no matches from filtering, use all
  if (places.length === 0) {
    places = mockData.places || []
  }

  // Exclude places already in DB as leads
  const { data: existingLeads } = await supabase
    .from('leads')
    .select('google_place_id')
  const existingIds = new Set((existingLeads || []).map((l: any) => l.google_place_id))
  places = places.filter((p) => !existingIds.has(p.id))

  places = places.slice(0, limit)

  await agentLog('scout', `[MOCK] Found ${places.length} new leads (limit: ${limit}), upserting...`, { runId: pipelineRunId })

  const leadIds: string[] = []

  for (const place of places) {
    if (!place.nationalPhoneNumber) continue

    const { data, error } = await supabase
      .from('leads')
      .upsert({
        name: place.displayName.text,
        category: place.types?.[0]?.replace(/_/g, ' ') || 'local business',
        address: place.formattedAddress,
        phone: place.nationalPhoneNumber,
        google_place_id: place.id,
        google_rating: place.rating || null,
        google_review_count: place.userRatingCount || null,
        website_detected: null,
        status: 'discovered',
        pipeline_run_id: pipelineRunId,
      }, { onConflict: 'google_place_id' })
      .select('id')
      .single()

    if (error) {
      await agentLog('scout', `[MOCK] Failed to save ${place.displayName.text}: ${error.message}`, {
        runId: pipelineRunId, level: 'error',
      })
      continue
    }

    leadIds.push(data.id)
  }

  await agentLog('scout', `[MOCK] Scouting complete: ${leadIds.length} leads`, {
    runId: pipelineRunId, level: 'success',
  })

  return leadIds
}

export async function runScoutAgent(query: string, pipelineRunId: string, limit = 3): Promise<string[]> {
  // Mock toggle
  if (process.env.MOCK_SCOUT === 'true') {
    return runMockScout(query, pipelineRunId, limit)
  }

  await agentLog('scout', `Searching: ${query}`, { runId: pipelineRunId })

  // Use Places API (New) — Text Search
  const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types'
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: Math.min(limit * 4, 20)
    })
  })

  const searchData = await searchRes.json() as { places?: Place[] }
  const places = searchData.places || []

  await agentLog('scout', `Found ${places.length} places, filtering...`, { runId: pipelineRunId })

  const leadIds: string[] = []

  for (const place of places) {
    // Stop if we've hit the limit
    if (leadIds.length >= limit) break

    // Filter — no website = valid lead
    if (place.websiteUri) {
      await agentLog('scout', `Skipping ${place.displayName.text} -- has website`, { runId: pipelineRunId })
      continue
    }

    if (!place.nationalPhoneNumber) {
      await agentLog('scout', `Skipping ${place.displayName.text} -- no phone number`, { runId: pipelineRunId })
      continue
    }

    // Upsert to Supabase
    const { data, error } = await supabase
      .from('leads')
      .upsert({
        name: place.displayName.text,
        category: place.types?.[0]?.replace(/_/g, ' ') || 'local business',
        address: place.formattedAddress,
        phone: place.nationalPhoneNumber,
        google_place_id: place.id,
        google_rating: place.rating || null,
        google_review_count: place.userRatingCount || null,
        website_detected: null,
        status: 'discovered',
        pipeline_run_id: pipelineRunId
      }, { onConflict: 'google_place_id' })
      .select('id')
      .single()

    if (error) {
      await agentLog('scout', `Failed to save ${place.displayName.text}: ${error.message}`, {
        runId: pipelineRunId,
        level: 'error'
      })
      continue
    }

    leadIds.push(data.id)
    await agentLog('scout', `Found lead: ${place.displayName.text} (${place.nationalPhoneNumber})`, {
      runId: pipelineRunId,
      level: 'success'
    })
  }

  await agentLog('scout', `Scouting complete: ${leadIds.length} valid leads`, {
    runId: pipelineRunId,
    level: 'success'
  })

  return leadIds
}
