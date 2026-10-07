import { ImajinFooter } from '@ima-jin/ui';
import { LandingActions } from '@/components/LandingActions';

const FEATURES = [
  { icon: '📝', title: 'Powerful form builder', body: 'Create surveys with text, multiple choice, ratings, and more. Live preview as you build.' },
  { icon: '🔏', title: 'Signed responses', body: 'Every response is signed by the person who gave it, so you know who said what — no guessing, no spoofing.' },
  { icon: '📈', title: 'Built-in analytics', body: 'View response breakdowns, charts, and export to CSV.' },
  { icon: '🎯', title: 'Event integration', body: 'Link surveys to Imajin events for pre/post-event feedback, open only to ticket holders.' },
] as const;

/** What dykil is, plus the sign-in / dashboard / create entry points. */
export function Landing() {
  return (
    <div className="bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black">
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 text-6xl" aria-hidden="true">
            📊
          </div>
          <h1 className="mb-4 text-4xl font-bold">dykil</h1>
          <p className="mb-8 text-xl text-gray-600 dark:text-gray-400">
            Sovereign surveys and polls.
            <br />
            Your forms. Your data. No tracking.
          </p>
          <LandingActions />
          <div className="mb-8 rounded-xl bg-white p-8 text-left shadow-lg dark:bg-gray-800">
            <h2 className="mb-4 text-center text-2xl font-semibold">Why Dykil?</h2>
            <ul className="space-y-4">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex items-start gap-4">
                  <div className="text-2xl" aria-hidden="true">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="text-sm text-gray-500">{feature.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <ImajinFooter className="mt-8" />
        </div>
      </div>
    </div>
  );
}
