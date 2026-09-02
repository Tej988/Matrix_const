import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import type { BusinessProfile } from '@mc/types'
import { DEFAULT_BUSINESS } from '@mc/types'

/**
 * Application settings — a single document, `settings/app`.
 *
 * The business profile lives here rather than in code because it is the
 * business's identity: it appears on every bill and quotation a client
 * receives. It was hardcoded once, which put the wrong name on real documents.
 */
export function createSettingsRepository(db: Firestore) {
  const ref = doc(db, 'settings', 'app')

  return {
    async getBusiness(): Promise<BusinessProfile> {
      const snap = await getDoc(ref)
      const stored = snap.exists() ? (snap.data()['business'] as Partial<BusinessProfile>) : null
      if (!stored) return DEFAULT_BUSINESS

      // Merged rather than trusted wholesale: a document written before a field
      // existed must not produce an undefined where the PDF expects a string.
      return {
        ...DEFAULT_BUSINESS,
        ...stored,
        addressLines: stored.addressLines ?? [],
      }
    },

    async saveBusiness(business: BusinessProfile, actorUid: string): Promise<void> {
      await setDoc(
        ref,
        {
          business,
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true },
      )
    },
  }
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>
