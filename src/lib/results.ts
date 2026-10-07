import type { SurveyJSElement } from '@/lib/survey';

/** A response as the owner's `GET /api/surveys/:id/responses` returns it — an attestation row. */
export interface ResponseRow {
  id: string;
  issuerDid: string;
  issuedAt: string;
  payload: { answers?: Record<string, unknown>; provenance?: string } | null;
}

export interface FieldAggregate {
  field: SurveyJSElement;
  /** Answers given (non-empty). */
  total: number;
  /** Count per choice / rating value / boolean ('true' | 'false'). */
  values: Record<string, number>;
  /** Free-text answers, each keyed by the response that gave it. */
  texts: Array<{ responseId: string; text: string }>;
  /** Rating questions only. */
  average?: number;
}

export type Aggregation = Record<string, FieldAggregate>;

const TEXT_TYPES = new Set(['text', 'comment']);
const SINGLE_VALUE_TYPES = new Set(['radiogroup', 'dropdown', 'boolean', 'rating']);

export function answersOf(row: ResponseRow): Record<string, unknown> {
  return row.payload?.answers ?? {};
}

function isAnswered(answer: unknown): boolean {
  return answer !== undefined && answer !== null && answer !== '';
}

function bump(values: Record<string, number>, key: string): void {
  values[key] = (values[key] ?? 0) + 1;
}

function tally(aggregate: FieldAggregate, answer: unknown, responseId: string): void {
  const { type, inputType } = aggregate.field;
  if (TEXT_TYPES.has(type) || inputType === 'email') {
    aggregate.texts.push({ responseId, text: String(answer) });
  } else if (SINGLE_VALUE_TYPES.has(type)) {
    bump(aggregate.values, String(type === 'rating' ? Number(answer) : answer));
  } else if (type === 'checkbox') {
    for (const choice of Array.isArray(answer) ? answer : [answer]) bump(aggregate.values, String(choice));
  }
}

function ratingAverage(aggregate: FieldAggregate): number {
  if (aggregate.total === 0) return 0;
  const sum = Object.entries(aggregate.values).reduce((acc, [value, count]) => acc + Number(value) * count, 0);
  return sum / aggregate.total;
}

/** Per-question tallies over every response — the owner's results view. */
export function aggregateResponses(elements: readonly SurveyJSElement[], rows: readonly ResponseRow[]): Aggregation {
  const aggregation: Aggregation = {};
  for (const field of elements) {
    const aggregate: FieldAggregate = { field, total: 0, values: {}, texts: [] };
    for (const row of rows) {
      const answer = answersOf(row)[field.name];
      if (!isAnswered(answer)) continue;
      aggregate.total += 1;
      tally(aggregate, answer, row.id);
    }
    if (field.type === 'rating') aggregate.average = ratingAverage(aggregate);
    aggregation[field.name] = aggregate;
  }
  return aggregation;
}

export interface BarEntry {
  label: string;
  count: number;
}

/** The bars a choice / boolean / rating question draws: most-chosen first, Yes/No fixed, ratings ascending. */
export function barEntries(aggregate: FieldAggregate): BarEntry[] {
  const { values, field } = aggregate;
  if (field.type === 'boolean') {
    return [
      { label: 'Yes', count: values.true ?? 0 },
      { label: 'No', count: values.false ?? 0 },
    ];
  }
  const entries = Object.entries(values).map(([label, count]) => ({ label, count }));
  if (field.type === 'rating') return entries.sort((a, b) => Number(a.label) - Number(b.label));
  return entries.sort((a, b) => b.count - a.count);
}

/** How an answer reads in the individual-responses list and the CSV export. */
export function formatAnswer(field: SurveyJSElement, answer: unknown): string {
  if (!isAnswered(answer)) return '';
  if (field.type === 'boolean') return answer ? 'Yes' : 'No';
  if (Array.isArray(answer)) return answer.join(', ');
  return String(answer);
}

/** Spreadsheet apps evaluate cells that start with these as formulas. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** A question's CSV column header: its export label when it has one, else its title. */
function columnLabel(field: SurveyJSElement): string {
  return typeof field.exportLabel === 'string' && field.exportLabel ? field.exportLabel : field.title;
}

/** The owner's CSV export: one row per response, one column per question. */
export function buildCsv(elements: readonly SurveyJSElement[], rows: readonly ResponseRow[]): string {
  const header = ['Response ID', 'Submitted At', ...elements.map(columnLabel)];
  const body = rows.map((row) => [
    row.id,
    row.issuedAt,
    ...elements.map((field) => formatAnswer(field, answersOf(row)[field.name]).replaceAll(', ', '; ')),
  ]);
  return [header, ...body].map((cells) => cells.map(csvCell).join(',')).join('\n');
}

export function csvFilename(title: string): string {
  return `${title.replaceAll(/[^a-z0-9]/gi, '_')}_results.csv`;
}
