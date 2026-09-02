import { z } from 'zod'
import { ROLES, USER_STATUSES, LOCALES } from '@mc/types'

/**
 * Zod schemas, shared between forms, repositories, and tests so a shape is
 * defined once. Firestore Security Rules re-validate independently, because
 * client validation is a convenience and Rules are the boundary (R-03).
 */

/** An integer count of paise. A float here means a bug upstream (ADR-004). */
export const paiseSchema = z
  .number()
  .int('Amount must be a whole number of paise')
  .nonnegative('Amount cannot be negative')
  .max(100_000_000_000, 'Amount is implausibly large')

export const positivePaiseSchema = paiseSchema.positive('Amount must be greater than zero')

export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

export const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Expected a YYYY-MM period')

/** Indian mobile numbers, optionally with the +91 prefix. */
export const phoneSchema = z
  .string()
  .regex(/^(\+91[- ]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')

export const roleSchema = z.enum(ROLES)
export const userStatusSchema = z.enum(USER_STATUSES)
export const localeSchema = z.enum(LOCALES)

export const userProfileSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(120),
  email: z.string().email(),
  photoUrl: z.string().url().optional(),
  phone: phoneSchema.optional(),
  role: roleSchema,
  status: userStatusSchema,
  locale: localeSchema,
})

/** The subset a user may change about themselves - never role or status. */
export const userSelfEditSchema = userProfileSchema.pick({
  displayName: true,
  phone: true,
  locale: true,
})

export type UserProfileInput = z.infer<typeof userProfileSchema>
export type UserSelfEditInput = z.infer<typeof userSelfEditSchema>
