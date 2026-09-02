import { z } from 'zod'

/**
 * Environment configuration, validated once at startup so a missing key surfaces
 * as a clear setup screen instead of a broken render three routes later.
 *
 * None of this is secret. The Firebase web config and the OAuth client ID are
 * public identifiers by design - security comes from Security Rules and App
 * Check, not from hiding them. See SECURITY.md section 6.
 */
const envSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_FIREBASE_APP_ID: z.string().min(1),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  VITE_GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  VITE_DRIVE_FOLDER_ID: z.string().optional(),
  VITE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  VITE_USE_EMULATORS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.safeParse(import.meta.env)

/**
 * Non-null when configuration is incomplete. Checked in main.tsx before the app
 * (and therefore Firebase) is loaded, so a fresh clone renders instructions
 * rather than a stack trace.
 */
export const envError: string | null = parsed.success
  ? null
  : parsed.error.issues.map((i) => i.path.join('.')).join(', ')

export const env: Env = parsed.success ? parsed.data : ({} as Env)

export const isDevelopment = env.VITE_ENV === 'development'
export const useEmulators = env.VITE_USE_EMULATORS === true
