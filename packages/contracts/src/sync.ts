import {z} from 'zod';

export const MAX_SYNC_OPERATIONS = 100;

const entityId = z.uuid();
// PostgreSQL text cannot contain NUL and its AD timestamps start at year 0001.
const catalogueId = z
  .string()
  .min(1)
  .refine(id => !id.includes('\0'), 'Catalogue ID must not contain NUL.');
const catalogueVersion = z.string().min(1);
const timestamp = z.iso
  .datetime()
  .refine(
    time => !/\.\d{4}/.test(time),
    'Use at most three fractional second digits.',
  )
  .refine(
    time => !time.startsWith('0000-'),
    'Timestamp year must be at least 0001.',
  );
const nonnegativeInteger = z.int().nonnegative();

export const PlannedDurationSecondsSchema = z
  .int()
  .min(900)
  .max(10800)
  .multipleOf(300);

const operationIdentity = {operationId: entityId};
const sessionOperation = {...operationIdentity, sessionId: entityId};
const startDetails = {
  ...sessionOperation,
  chestId: catalogueId,
  plannedDurationSeconds: PlannedDurationSecondsSchema,
};

export const SyncOperationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...operationIdentity,
    type: z.literal('buy_chest'),
    chestId: catalogueId,
  }),
  z.strictObject({...startDetails, type: z.literal('start_session')}),
  z.strictObject({...sessionOperation, type: z.literal('claim_reward')}),
  z.strictObject({...sessionOperation, type: z.literal('cancel_session')}),
  z.strictObject({
    ...startDetails,
    type: z.literal('offline_session_claim'),
    startedAt: timestamp,
    endedAt: timestamp,
    itemInstanceId: entityId,
    itemId: catalogueId,
  }),
]);

export type SyncOperation = z.infer<typeof SyncOperationSchema>;

export const SyncOperationTypeSchema = z.enum([
  'buy_chest',
  'start_session',
  'claim_reward',
  'cancel_session',
  'offline_session_claim',
] satisfies SyncOperation['type'][]);

// The server validates each entry separately so one rejection can preserve the batch order.
export const SyncRequestEnvelopeSchema = z.strictObject({
  operations: z.array(z.unknown()).min(1).max(MAX_SYNC_OPERATIONS),
  knownRevision: nonnegativeInteger.optional(),
});

export const SyncRequestSchema = SyncRequestEnvelopeSchema.extend({
  operations: SyncRequestEnvelopeSchema.shape.operations.pipe(
    z.array(SyncOperationSchema),
  ),
});

// Keep rarity values in ascending order for the selector's fallback rule.
export const ItemRaritySchema = z.enum([
  'common',
  'rare',
  'epic',
  'legendary',
  'mythic',
]);

const catalogueEntity = {
  id: catalogueId,
  name: z.string().min(1),
  description: z.json(),
  spriteX: nonnegativeInteger,
  spriteY: nonnegativeInteger,
};

const catalogue = z.strictObject({
  items: z.array(
    z.strictObject({
      ...catalogueEntity,
      rarity: ItemRaritySchema,
      stats: z.json(),
    }),
  ),
  chests: z.array(
    z.strictObject({...catalogueEntity, price: nonnegativeInteger}),
  ),
  chestItems: z.array(
    z.strictObject({
      chestId: catalogueId,
      itemId: catalogueId,
      weight: z.int().positive(),
    }),
  ),
});

export const UserSnapshotSchema = z.strictObject({
  revision: nonnegativeInteger,
  catalogueVersion,
  user: z.strictObject({id: entityId, coins: nonnegativeInteger}),
  catalogue,
  userChests: z.array(
    z.strictObject({chestId: catalogueId, unlockedAt: timestamp}),
  ),
  items: z.array(
    z.strictObject({
      id: entityId,
      itemId: catalogueId,
      sessionId: entityId.nullable(),
      acquisitionSource: z.enum([
        'account_creation',
        'session_reward',
        'offline_claim',
      ]),
      isVerified: z.boolean(),
      receivedAt: timestamp,
    }),
  ),
  sessions: z.array(
    z.strictObject({
      id: entityId,
      chestId: catalogueId,
      origin: z.enum(['online', 'offline']),
      status: z.enum(['running', 'cancelled', 'completed']),
      plannedDurationSeconds: PlannedDurationSecondsSchema,
      startedAt: timestamp,
      endedAt: timestamp.nullable(),
    }),
  ),
});

export const OperationOutcomeSchema = z.strictObject({
  ...operationIdentity,
  type: SyncOperationTypeSchema,
  status: z.enum([
    'accepted',
    'accepted_unverified',
    'already_processed',
    'rejected',
  ]),
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  sessionId: entityId.optional(),
  itemInstanceId: entityId.optional(),
  retryable: z.boolean().default(false),
});

export const SyncResponseSchema = z.strictObject({
  outcomes: z.array(OperationOutcomeSchema),
  snapshot: UserSnapshotSchema,
});

export const SnapshotResponseSchema = z.discriminatedUnion('unchanged', [
  z.strictObject({unchanged: z.literal(false), snapshot: UserSnapshotSchema}),
  z.strictObject({
    unchanged: z.literal(true),
    revision: nonnegativeInteger,
    catalogueVersion,
  }),
]);

export type ItemRarity = z.infer<typeof ItemRaritySchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type UserSnapshot = z.infer<typeof UserSnapshotSchema>;
export type OperationOutcome = z.infer<typeof OperationOutcomeSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>;
