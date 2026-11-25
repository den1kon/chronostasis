import {isRarityEligibleForDuration} from '@chronostasis/contracts';
import {useState} from 'react';
import {FocusTimer} from './focus-timer';
import {buttonStyle, panelStyle, secondaryButtonStyle} from './gameplay-styles';
import {RewardItem} from './reward-item';
import {useAccountSync} from './sync-context';
import {sessionDeadlineMs} from './sync-model';

const durations = Array.from({length: 34}, (_, index) => 15 + index * 5);
const selectStyle =
  'w-full rounded-lg border border-outline bg-forest p-2.5 text-parchment focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf';

export function FocusGameplay() {
  const {engine, state} = useAccountSync();
  const {snapshot, pending, localSession, view, online} = state;
  const {catalogue} = snapshot;
  const [selectedChestId, setSelectedChestId] = useState('');
  const [duration, setDuration] = useState(25);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const chest =
    catalogue.chests.find(entry => entry.id === selectedChestId) ??
    catalogue.chests.find(entry => view.unlockedChestIds.includes(entry.id)) ??
    catalogue.chests[0];
  const plannedDurationSeconds = duration * 60;
  const chestItems = catalogue.items.filter(item =>
    catalogue.chestItems.some(
      entry => entry.chestId === chest?.id && entry.itemId === item.id,
    ),
  );
  const hasEligibleRewards = chestItems.some(({rarity}) =>
    isRarityEligibleForDuration(rarity, plannedDurationSeconds),
  );
  const canonicallyUnlocked = snapshot.userChests.some(
    entry => entry.chestId === chest?.id,
  );
  const purchasePending = pending.some(
    op => op.type === 'buy_chest' && op.chestId === chest?.id,
  );
  const running = snapshot.sessions.find(
    session => session.origin === 'online' && session.status === 'running',
  );
  const pendingStart = pending.some(op => op.type === 'start_session');
  const pendingFinish = pending.find(
    op =>
      (op.type === 'claim_reward' || op.type === 'cancel_session') &&
      op.sessionId === running?.id,
  );
  const earlyClaim =
    pendingFinish?.type === 'claim_reward' &&
    state.outcomes.some(
      outcome =>
        outcome.operationId === pendingFinish.operationId &&
        outcome.status === 'rejected' &&
        outcome.retryable &&
        outcome.code === 'session_too_early',
    );
  const offlineClaimPending = pending.some(
    op => op.type === 'offline_session_claim',
  );

  // A queued online finish frees the offline timer. New online starts wait for reconciliation.
  const activeOnline =
    !pendingFinish || (earlyClaim && online) ? running : undefined;
  const active = localSession ?? activeOnline;
  const activeId = localSession?.sessionId ?? activeOnline?.id;
  const startAllowed =
    hasEligibleRewards &&
    (online
      ? canonicallyUnlocked && !pendingFinish && !offlineClaimPending
      : Boolean(chest && view.unlockedChestIds.includes(chest.id)));

  // Provisional items follow durable queue order and carry device timestamps.
  const lastReward =
    view.items.findLast(item => item.pending) ??
    view.items.reduce<(typeof view.items)[number] | undefined>(
      (latest, item) =>
        item.sessionId && (!latest || item.receivedAt >= latest.receivedAt)
          ? item
          : latest,
      undefined,
    );

  function perform(action: () => Promise<void>) {
    setActionError(null);
    setBusy(true);
    void action()
      .catch((error: unknown) => {
        setActionError(
          error instanceof Error && !(error instanceof DOMException)
            ? error.message
            : 'Could not save the action. Please try again.',
        );
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function start() {
    if (!chest || !startAllowed) return;
    perform(() =>
      online
        ? engine.submitOperation({
            type: 'start_session',
            operationId: crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
            chestId: chest.id,
            plannedDurationSeconds,
          })
        : engine.startOfflineSession(chest.id, plannedDurationSeconds),
    );
  }

  function finish(type: 'claim_reward' | 'cancel_session', sessionId: string) {
    perform(() => {
      if (localSession?.sessionId !== sessionId) {
        return engine.submitOperation({
          type,
          operationId: crypto.randomUUID(),
          sessionId,
        });
      }
      return type === 'claim_reward'
        ? engine.completeOfflineSession(sessionId)
        : engine.cancelOfflineSession(sessionId);
    });
  }

  return (
    <>
      <section aria-labelledby="focus-heading" className={panelStyle}>
        <h2 id="focus-heading" className="text-2xl font-semibold">
          {active ? 'Your focus session' : 'Your next focus session'}
        </h2>
        {pendingStart && (
          <p role="status" className="mt-4 text-leaf">
            Start pending
          </p>
        )}
        {pendingFinish && (
          <p role="status" className="mt-4 text-leaf">
            {pendingFinish.type === 'claim_reward'
              ? 'Reward pending'
              : 'Cancellation pending'}
          </p>
        )}
        {earlyClaim && running && (localSession || !online) && (
          <button
            type="button"
            className={secondaryButtonStyle}
            disabled={busy}
            onClick={() => {
              finish('cancel_session', running.id);
            }}
          >
            Cancel online session
          </button>
        )}
        {active && activeId ? (
          <FocusTimer
            key={activeId}
            deadline={sessionDeadlineMs(active)}
            chestName={
              catalogue.chests.find(entry => entry.id === active.chestId)
                ?.name ?? 'Focus chest'
            }
            offline={Boolean(localSession)}
            busy={busy}
            claimPending={!localSession && earlyClaim}
            onClaim={() => {
              finish('claim_reward', activeId);
            }}
            onCancel={() => {
              finish('cancel_session', activeId);
            }}
          />
        ) : (
          !pendingStart &&
          !(online && pendingFinish) && (
            <div className="mt-5 space-y-5">
              <p className="text-sm font-semibold text-leaf">
                {view.coins} coins
              </p>
              {chest ? (
                <>
                  <label className="block space-y-1.5">
                    <span className="block text-sm font-semibold">Chest</span>
                    <select
                      className={selectStyle}
                      value={chest.id}
                      onChange={event => {
                        setSelectedChestId(event.target.value);
                      }}
                    >
                      {catalogue.chests.map(entry => (
                        <option value={entry.id} key={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    {canonicallyUnlocked ? (
                      <p className="text-sm text-leaf">Unlocked</p>
                    ) : purchasePending ? (
                      <p role="status" className="text-sm text-leaf">
                        Purchase pending
                      </p>
                    ) : (
                      <>
                        <p className="text-sm text-parchment/80">
                          {chest.price === 0
                            ? 'Free'
                            : `${String(chest.price)} coins to unlock`}
                        </p>
                        <button
                          type="button"
                          className={secondaryButtonStyle}
                          disabled={busy || view.coins < chest.price}
                          onClick={() => {
                            perform(() =>
                              engine.submitOperation({
                                type: 'buy_chest',
                                chestId: chest.id,
                                operationId: crypto.randomUUID(),
                              }),
                            );
                          }}
                        >
                          Unlock chest
                        </button>
                      </>
                    )}
                  </div>
                  <label className="block space-y-1.5">
                    <span className="block text-sm font-semibold">
                      Duration
                    </span>
                    <select
                      className={selectStyle}
                      value={duration}
                      aria-describedby={
                        hasEligibleRewards
                          ? undefined
                          : 'focus-reward-eligibility'
                      }
                      onChange={event => {
                        setDuration(Number(event.target.value));
                      }}
                    >
                      {durations.map(minutes => (
                        <option value={minutes} key={minutes}>
                          {minutes} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                  {!hasEligibleRewards && (
                    <p
                      id="focus-reward-eligibility"
                      className="text-sm text-leaf"
                    >
                      {chestItems.length
                        ? 'Mythic rewards require at least 1 hour.'
                        : 'This chest has no eligible rewards.'}
                    </p>
                  )}
                  {online && offlineClaimPending && (
                    <p role="status" className="text-sm text-leaf">
                      Sync your offline reward before starting online.
                    </p>
                  )}
                  <button
                    type="button"
                    className={buttonStyle}
                    disabled={busy || !startAllowed}
                    onClick={start}
                  >
                    Start focus
                  </button>
                </>
              ) : (
                <p>No chests are available.</p>
              )}
            </div>
          )
        )}
        {actionError && (
          <p role="alert" className="mt-4 text-parchment/85">
            {actionError}
          </p>
        )}
      </section>
      {lastReward && (
        <section aria-labelledby="latest-reward-heading" className={panelStyle}>
          <h2 id="latest-reward-heading" className="mb-4 text-xl font-semibold">
            Latest reward
          </h2>
          <RewardItem
            item={lastReward}
            catalogueItem={catalogue.items.find(
              entry => entry.id === lastReward.itemId,
            )}
          />
        </section>
      )}
    </>
  );
}
