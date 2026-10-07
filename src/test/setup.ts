import { afterEach } from 'vitest';

// jest-dom matchers and RTL cleanup only make sense where a DOM exists; route and
// lib tests run on the node environment and must not load them.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  await import('@testing-library/jest-dom/vitest');
  afterEach(() => cleanup());
}
