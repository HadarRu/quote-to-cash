'use client';

import { strings } from '@q2c/ui';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container center" role="alert">
      <h1>{strings.states.error}</h1>
      <button type="button" className="button" onClick={reset}>
        {strings.states.retry}
      </button>
    </main>
  );
}
