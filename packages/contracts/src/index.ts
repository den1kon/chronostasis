import {z} from 'zod';

export const PublicUserSchema = z.object({
  id: z.uuid(),
  clerkUserId: z.string().trim().min(1),
});
export const UserResponseSchema = z.object({user: PublicUserSchema});
export const HealthResponseSchema = z.object({status: z.literal('ok')});
export const ApiErrorSchema = z.object({
  error: z.object({code: z.string().min(1), message: z.string().min(1)}),
});

export type PublicUser = z.infer<typeof PublicUserSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

export {
  isRarityEligibleForDuration,
  selectChestReward,
} from './reward-selection.js';
export type {ChestRewardCandidate} from './reward-selection.js';
export {
  ItemRaritySchema,
  MAX_SYNC_OPERATIONS,
  OperationOutcomeSchema,
  PlannedDurationSecondsSchema,
  SnapshotResponseSchema,
  SyncOperationSchema,
  SyncOperationTypeSchema,
  SyncRequestEnvelopeSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  UserSnapshotSchema,
} from './sync.js';
export type {
  ItemRarity,
  OperationOutcome,
  SnapshotResponse,
  SyncOperation,
  SyncRequest,
  SyncResponse,
  UserSnapshot,
} from './sync.js';
