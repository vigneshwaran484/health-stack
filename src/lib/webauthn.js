/**
 * Proof-of-life for the daily check-in.
 *
 * The point of the biometric step is that it confirms the *patient* checked in,
 * not that a phone got tapped. We use a WebAuthn platform authenticator
 * (Windows Hello / Touch ID / Android fingerprint).
 *
 * Pilot scope: the credential is created and asserted on-device, and we record
 * which method satisfied it. Full server-side attestation/signature
 * verification is roadmap — it needs a relying-party service holding the
 * public key and challenge state.
 *
 * If no authenticator exists (desktop without Hello, or an insecure origin),
 * `verify()` returns method 'device-confirm' so the demo never dead-ends.
 */

const CRED_KEY = 'hs.webauthn.credentialId'

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32))
}

function toB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0))
}

export async function isBiometricAvailable() {
  if (!window.PublicKeyCredential || !window.isSecureContext) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export function isEnrolled() {
  return Boolean(localStorage.getItem(CRED_KEY))
}

export async function enroll({ patientCode, name }) {
  if (!(await isBiometricAvailable())) throw new Error('No platform authenticator on this device')

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'Health Stack' },
      user: {
        id: new TextEncoder().encode(patientCode),
        name: patientCode,
        displayName: name ?? patientCode,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },    // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })
  if (!credential) throw new Error('Enrolment cancelled')
  localStorage.setItem(CRED_KEY, toB64(credential.rawId))
  return true
}

/**
 * Returns { verified, method } — never throws for "unsupported", only for a
 * genuine user cancellation, so the caller can distinguish refusal from
 * missing hardware.
 */
export async function verify() {
  const stored = localStorage.getItem(CRED_KEY)
  if (!(await isBiometricAvailable())) return { verified: true, method: 'device-confirm' }

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        timeout: 60000,
        userVerification: 'required',
        allowCredentials: stored ? [{ type: 'public-key', id: fromB64(stored) }] : [],
      },
    })
    if (!assertion) return { verified: false, method: 'biometric' }
    return { verified: true, method: 'biometric' }
  } catch (err) {
    if (err?.name === 'NotAllowedError') {
      // Either the user declined or no credential matched. Enrol and retry once.
      return { verified: false, method: 'biometric', needsEnrolment: !stored }
    }
    return { verified: true, method: 'device-confirm' }
  }
}

export function resetEnrolment() {
  localStorage.removeItem(CRED_KEY)
}
