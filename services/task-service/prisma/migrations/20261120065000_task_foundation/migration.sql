-- CreateEnum
CREATE TYPE "OutboxDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskEventType" AS ENUM ('TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_STATUS_UPDATED', 'TASK_UPDATED', 'TASK_DELETED', 'TEAM_BOARD_READY');

-- CreateTable
CREATE TABLE "BoardStatus" (
    "id" UUID NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "position" INTEGER NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BoardStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "teamId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "statusId" UUID NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskOutboxEvent" (
    "id" UUID NOT NULL,
    "eventType" "TaskEventType" NOT NULL,
    "teamId" TEXT NOT NULL,
    "taskId" UUID,
    "recipientId" TEXT,
    "payload" JSONB NOT NULL,
    "deliveryStatus" "OutboxDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardStatus_teamId_name_key" ON "BoardStatus"("teamId", "name");
CREATE UNIQUE INDEX "BoardStatus_teamId_position_key" ON "BoardStatus"("teamId", "position");
CREATE INDEX "BoardStatus_teamId_deletedAt_position_idx" ON "BoardStatus"("teamId", "deletedAt", "position");
CREATE INDEX "Task_teamId_deletedAt_idx" ON "Task"("teamId", "deletedAt");
CREATE INDEX "Task_statusId_deletedAt_idx" ON "Task"("statusId", "deletedAt");
CREATE INDEX "Task_assigneeId_deletedAt_idx" ON "Task"("assigneeId", "deletedAt");
CREATE INDEX "Comment_taskId_deletedAt_createdAt_idx" ON "Comment"("taskId", "deletedAt", "createdAt");
CREATE INDEX "TaskOutboxEvent_deliveryStatus_availableAt_idx" ON "TaskOutboxEvent"("deliveryStatus", "availableAt");
CREATE INDEX "TaskOutboxEvent_teamId_createdAt_idx" ON "TaskOutboxEvent"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "BoardStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskOutboxEvent" ADD CONSTRAINT "TaskOutboxEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
