-- owner: dykil
-- Derived from ima-jin/imajin-ai root 0001_seed.sql and 0008_survey_response_ticket_id.sql.
-- Root 0025/0026 only backfilled data across owners: deliberately NOT replayed.
-- Root 0027 only drops an events table: no dykil DDL.
-- Historical root SQL remains immutable. Existing matching schemas are adopted, not replayed.

CREATE TABLE dykil.surveys (
    id text PRIMARY KEY,
    did text NOT NULL,
    title text NOT NULL,
    description text,
    fields jsonb NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    handle text,
    type text DEFAULT 'survey'::text NOT NULL
);

CREATE TABLE dykil.survey_responses (
    id text PRIMARY KEY,
    survey_id text NOT NULL,
    respondent_did text,
    answers jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    ticket_id text,
    CONSTRAINT survey_responses_survey_id_surveys_id_fk
        FOREIGN KEY (survey_id) REFERENCES dykil.surveys(id) ON DELETE CASCADE
);

CREATE INDEX idx_responses_created ON dykil.survey_responses USING btree (created_at);
CREATE INDEX idx_responses_respondent ON dykil.survey_responses USING btree (respondent_did);
CREATE INDEX idx_responses_survey ON dykil.survey_responses USING btree (survey_id);
CREATE INDEX idx_surveys_did ON dykil.surveys USING btree (did);
CREATE INDEX idx_surveys_handle ON dykil.surveys USING btree (handle);
CREATE INDEX idx_surveys_status ON dykil.surveys USING btree (status);
CREATE INDEX idx_responses_ticket_id ON dykil.survey_responses USING btree (ticket_id)
    WHERE ticket_id IS NOT NULL;
