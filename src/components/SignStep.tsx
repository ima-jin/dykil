'use client';

import { useState } from 'react';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, MUTED } from '@/components/ui';

/**
 * The respondent-signature step.
 *
 * A response is "DID X said Y about this survey, signed" — signed by the
 * respondent's OWN key, never by this app. A signed-in browser session holds
 * no signing key and the published SDK has no browser signing helper, so the
 * respondent signs the exact payload below with their DID's Ed25519 key
 * (e.g. with the imajin CLI) and pastes the hex signature. This step is the
 * graceful degradation of that gap; it disappears when the kernel offers a
 * session-scoped signer (see the gap(kernel) issue linked from the PR).
 */
export function SignStep({
  canonical,
  busy,
  error,
  onSubmit,
  onBack,
}: Readonly<{
  canonical: string;
  busy: boolean;
  error: string | null;
  onSubmit: (signature: string) => void;
  onBack: () => void;
}>) {
  const [signature, setSignature] = useState('');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(canonical);
    setCopied(true);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Sign your response</h2>
      <p className={`text-sm ${MUTED}`}>
        Responses are signed by the person who gave them, not by this app. Sign the payload below with your Imajin
        identity key and paste the signature (hex).
      </p>
      <div>
        <label htmlFor="sign-payload" className="mb-1 block text-sm font-medium">
          Payload to sign
        </label>
        <textarea id="sign-payload" readOnly rows={5} value={canonical} className={`${INPUT} font-mono text-xs`} />
        <button type="button" onClick={copy} className="mt-1 text-sm text-orange-500 hover:text-orange-600">
          {copied ? 'Copied' : 'Copy payload'}
        </button>
      </div>
      <div>
        <label htmlFor="sign-signature" className="mb-1 block text-sm font-medium">
          Signature (hex)
        </label>
        <input
          id="sign-signature"
          type="text"
          value={signature}
          onChange={(event) => setSignature(event.target.value)}
          className={`${INPUT} font-mono`}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={busy} className={BUTTON_SECONDARY}>
          Back to answers
        </button>
        <button
          type="button"
          onClick={() => onSubmit(signature.trim())}
          disabled={busy || signature.trim().length === 0}
          className={BUTTON_PRIMARY}
        >
          {busy ? 'Submitting…' : 'Submit signed response'}
        </button>
      </div>
    </div>
  );
}
