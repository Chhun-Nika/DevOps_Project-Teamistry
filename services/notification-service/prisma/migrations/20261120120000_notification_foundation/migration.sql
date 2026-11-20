CREATE TYPE "NotificationEventType" AS ENUM ('TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_STATUS_UPDATED', 'TASK_UPDATED', 'TASK_DELETED');

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "linkedTaskId" TEXT,
    "linkedTeamId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_sourceEventId_recipientId_key" ON "Notification"("sourceEventId", "recipientId");
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");
