import { supabase } from './supabase'

export const LAB_BUCKET = 'lab-media'

/**
 * Lab images live in a private bucket. Viewers get a short-lived signed URL,
 * and only after RLS already let them read the owning lab_result row.
 */
export async function signedLabMedia(path, seconds = 600) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(LAB_BUCKET).createSignedUrl(path, seconds)
  if (error) return null
  return data.signedUrl
}

export async function uploadLabMedia(file, labOrderId) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const path = `${labOrderId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(LAB_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error
  return path
}
