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

/**
 * Drop places that are already leads. A business already in the pipeline
 * (or already a paying customer) must never be re-inserted: the old upsert
 * reset its status to `discovered` and re-queued it for verification.
 */
async function filterKnownPlaces(places: Place[], tag: string, runId: string): Promise<Place[]> {
  if (places.length === 0) return places

  const { data: existing } = await supabase
    .from('leads')
    .select('google_place_id')
    .in('google_place_id', places.map(p => p.id))

  const known = new Set((existing || []).map((l: { google_place_id: string | null }) => l.google_place_id))
  const fresh = places.filter(p => !known.has(p.id))

  if (fresh.length < places.length) {
    await agentLog('scout', `${tag}Skipping ${places.length - fresh.length} place(s) already in the pipeline`, { runId })
  }
  return fresh
}

async function insertLead(place: Place, pipelineRunId: string): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      name: place.displayName.text,
      category: place.types?.[0]?.replace(/_/g, ' ') || 'local business',
      address: place.formattedAddress,
      phone: place.nationalPhoneNumber,
      google_place_id: place.id,
      google_rating: place.rating || null,
      google_review_count: place.userRatingCount || null,
      website_detected: place.websiteUri || null,
      status: 'discovered',
      pipeline_run_id: pipelineRunId,
    })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message || 'insert returned no row' }
  return { id: data.id }
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

  places = await filterKnownPlaces(places, '[MOCK] ', pipelineRunId)
  places = places.slice(0, limit)

  await agentLog('scout', `[MOCK] Found ${places.length} new leads (limit: ${limit}), inserting...`, { runId: pipelineRunId })

  const leadIds: string[] = []

  for (const place of places) {
    if (!place.nationalPhoneNumber) continue

    const result = await insertLead(place, pipelineRunId)
    if ('error' in result) {
      await agentLog('scout', `[MOCK] Failed to save ${place.displayName.text}: ${result.error}`, {
        runId: pipelineRunId, level: 'error',
      })
      continue
    }
    leadIds.push(result.id)
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

  // .env.example documents GOOGLE_PLACES_API_KEY; GOOGLE_MAPS_API_KEY kept for existing setups
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set (or set MOCK_SCOUT=true to use mock data)')
  }

  // Use Places API (New) — Text Search
  const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.types'
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: Math.min(limit * 4, 20)
    })
  })

  if (!searchRes.ok) {
    const body = await searchRes.text()
    throw new Error(`Google Places search failed (${searchRes.status}): ${body.slice(0, 300)}`)
  }

  const searchData = await searchRes.json() as { places?: Place[] }
  let places = searchData.places || []

  await agentLog('scout', `Found ${places.length} places, filtering...`, { runId: pipelineRunId })

  places = await filterKnownPlaces(places, '', pipelineRunId)

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

    const result = await insertLead(place, pipelineRunId)
    if ('error' in result) {
      await agentLog('scout', `Failed to save ${place.displayName.text}: ${result.error}`, {
        runId: pipelineRunId,
        level: 'error'
      })
      continue
    }

    leadIds.push(result.id)
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
