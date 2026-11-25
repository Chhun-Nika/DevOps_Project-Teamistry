# Event Contracts

This directory contains the shared RabbitMQ event envelope used by backend publishers and consumers.

Every event is published to the durable `teamisty.events` topic exchange:

```json
{
  "eventId": "stable-source-event-id",
  "eventType": "TEAM_CREATED",
  "occurredAt": "2026-11-25T12:00:00.000Z",
  "payload": { "teamId": "team-id" }
}
```

Board events:

- `TEAM_CREATED`: User & Team → Task; payload contains `teamId`.
- `TEAM_BOARD_READY`: Task → User & Team; payload contains `teamId`.

Notification events:

- `INVITATION_CREATED`: User & Team → Notification; payload contains `recipientId`, `teamId`, and `message`.
- `TASK_ASSIGNED`, `TASK_REASSIGNED`, `TASK_STATUS_UPDATED`, `TASK_UPDATED`, `TASK_DELETED`: Task → Notification; payload contains `recipientId` plus task/team context.

Consumers acknowledge only after successful handling. They retry failures up to three times and publish exhausted events to the service queue's dead-letter queue. Notification consumers deduplicate using `(eventId, recipientId)`.
