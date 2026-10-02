import { strings } from '@q2c/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container center">
      <h1>{strings.states.notFound}</h1>
      <Link href="/" className="button">
        {strings.states.backHome}
      </Link>
    </main>
  );
}
