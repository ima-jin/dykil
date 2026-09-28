import { withBasePath } from '@/lib/base-path';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-white">dykil</h1>
      <p className="mt-4 text-gray-400">
        Surveys &amp; polls, rebuilt on Imajin kernel primitives: a survey is a signed document, a
        response is an attestation, and ticket-holder checks compose through the events app&apos;s
        gate. This app owns no database of its own — see <code>FINDINGS.md</code> and{' '}
        <code>docs/ARCHITECTURE.md</code>.
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        <li>
          <a className="text-amber-400 hover:underline" href={withBasePath('/api/health')}>
            /api/health
          </a>
        </li>
        <li>
          <a className="text-amber-400 hover:underline" href={withBasePath('/api/spec')}>
            /api/spec
          </a>
        </li>
      </ul>
    </div>
  );
}
