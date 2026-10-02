import { strings } from '@q2c/ui';

export default function Loading() {
  return (
    <main className="container center" aria-busy="true">
      <p className="muted">{strings.states.loading}</p>
    </main>
  );
}
