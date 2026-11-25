import {useEffect, useState} from 'react';
import {buttonStyle, secondaryButtonStyle} from './gameplay-styles';

export function FocusTimer({
  deadline,
  chestName,
  offline,
  busy,
  claimPending,
  onClaim,
  onCancel,
}: {
  deadline: number;
  chestName: string;
  offline: boolean;
  busy: boolean;
  claimPending: boolean;
  onClaim: () => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Read the current wall time on each tick so the first tick after waking includes sleep.
    const handle = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');

  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-leaf">
        {offline ? 'Offline session' : 'Online session'}
      </p>
      <p className="mt-2 text-parchment/80">{chestName}</p>
      <p
        role="timer"
        aria-label="Focus time remaining"
        className="my-4 text-[clamp(2rem,12vw,4rem)] leading-tight font-bold tabular-nums"
      >
        {minutes}:{seconds}
      </p>
      <p className="sr-only" role="status">
        {remaining === 0 && !claimPending
          ? 'Your focus session is ready to claim.'
          : ''}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonStyle}
          disabled={busy || claimPending || remaining > 0}
          onClick={onClaim}
        >
          Claim reward
        </button>
        <button
          type="button"
          className={secondaryButtonStyle}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel session
        </button>
      </div>
    </div>
  );
}
