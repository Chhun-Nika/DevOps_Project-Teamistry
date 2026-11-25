ALTER TABLE "Task" ADD COLUMN "taskNumber" INTEGER;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "teamId" ORDER BY "createdAt", "id") AS number
  FROM "Task"
)
UPDATE "Task" AS task
SET "taskNumber" = numbered.number
FROM numbered
WHERE task."id" = numbered."id";

ALTER TABLE "Task" ALTER COLUMN "taskNumber" SET NOT NULL;

CREATE TABLE "TaskSequence" (
    "teamId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "TaskSequence_pkey" PRIMARY KEY ("teamId")
);

INSERT INTO "TaskSequence" ("teamId", "nextNumber")
SELECT "teamId", MAX("taskNumber") + 1
FROM "Task"
GROUP BY "teamId";

CREATE UNIQUE INDEX "Task_teamId_taskNumber_key" ON "Task"("teamId", "taskNumber");
