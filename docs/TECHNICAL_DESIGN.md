yes# Teamisty — Technical Design

**Status:** Review draft — proposed source of truth for architecture and contracts  
**Last updated:** 2026-11-16

## 1. System overview

```text
React frontend → API Gateway → User & Team Service → User & Team DB
                            → Task Service        → Task DB
                            → Notification Service → Notification DB

Task Service → User & Team Service: membership and role validation (internal REST)
User & Team Service → Task Service: active-task check before member removal (internal REST)

User & Team Service → Broker → Task Service: team-created event / board initialisation
Task Service → Broker → User & Team Service: board-ready event
User & Team Service → Broker → Notification Service: invitation-created event
Task Service → Broker → Notification Service: task-notification events
```

The gateway is the only public backend entry point. Internal service endpoints, databases, and RabbitMQ infrastructure remain on private networks.

## 2. Service boundaries and owned data

| Service | Owns | Does not own |
| --- | --- | --- |
| User & Team | Users, credentials, Google identity links, teams, team ownership, memberships, roles, invitations | Tasks and notification records |
| Task | Tasks, board statuses, task lifecycle, task-event outbox | User profiles, memberships, notification records |
| Notification | In-app notification records, read state, delivery idempotency | Team permissions, invitations, tasks |

Each service owns its own PostgreSQL database and Prisma schema. Services use IDs and APIs to reference another service's data; they never query another service's database.

## 3. Public routing

| Gateway route | Destination |
| --- | --- |
| `/api/auth/*`, `/api/users/*`, `/api/teams/*` | User & Team Service, except task-specific team routes |
| `/api/teams/{teamId}/tasks*`, `/api/tasks/*`, `/api/statuses/*` | Task Service |
| `/api/notifications/*` | Notification Service |

Task-specific team routes take priority over general team routes.

## 4. Authentication and authorization

- The User & Team Service issues HS256-signed JWTs after password or Google authentication. Access tokens expire after 15 minutes; refresh tokens expire after seven days.
- One strong `JWT_SECRET`, supplied only through environment configuration, signs and validates JWTs for this MVP. It is never committed or logged.
- The frontend sends the access token as `Authorization: Bearer <token>` for protected requests. The refresh token is stored only in a `Secure`, `HttpOnly` cookie and is sent only to authentication refresh/logout routes.
- `POST /auth/refresh` validates and rotates the refresh token, revokes its previous refresh session, then issues a new access token and refresh cookie. `POST /auth/logout` revokes the current refresh session and clears the cookie.
- Refresh sessions store a hashed refresh-token identifier, user ID, expiry, revocation state, and audit timestamps in User & Team Service. Browser deployments using cross-site cookies require `SameSite=None`, HTTPS, credentialed CORS, and CSRF protection on refresh/logout requests.
- Each service validates the JWT on its protected public routes.
- Team role is checked from the current active membership rather than permanently trusted from a JWT claim.
- User & Team Service is the authority for one Owner and at most one additional Leader per team. Ownership transfer must update this state atomically: the recipient becomes Owner and the previous Owner becomes a Member.
- Internal REST routes require an `X-Service-Token` issued to the calling service and must not be exposed anonymously. Broker publishers and consumers authenticate using broker credentials rather than this header.

Refresh-token transport/storage and rotation behaviour are defined above and must be implemented consistently by the frontend, gateway, and User & Team Service.

## 5. Service contracts

### User & Team Service

#### Functional requirements

User & Team Service is the authority for user identity and team membership. It owns user accounts, credentials, Google identity links, teams, memberships, leadership roles, and invitation lifecycle. It does not own tasks, board statuses, assignments, comments, or notification records.

##### Owned data and invariants

| Record | Required information and rules |
| --- | --- |
| User | Immutable ID; unique username and email; password hash only; optional display name; optional unique Google OpenID Connect subject; audit timestamps. |
| Refresh session | Immutable session ID; user ID; hashed refresh-token identifier; expiry; revocation timestamp/state; audit timestamps. |
| Team | Immutable ID; name; creator ID retained for history; `boardProvisioningStatus` (`PENDING` or `READY`); soft-delete fields and audit timestamps. |
| Membership | Immutable ID; user ID; team ID; `OWNER`, `LEADER`, or `MEMBER` role; active/removal state and audit timestamps. Only one active membership may exist for a user/team pair. |
| Invitation | Immutable ID; team, inviter, and invitee IDs; `PENDING`, `ACCEPTED`, `DECLINED`, or `CANCELLED` status; created/responded timestamps. |
| Invitation-notification outbox | Stable event ID; invitation/recipient context; delivery state and retry details. It is delivery metadata, not a Notification Service record. |
| Board-initialisation outbox | Stable event ID; team ID; delivery state and retry details. It requests initial board creation from Task Service. |

- Every active team has exactly one active `OWNER` membership and zero or one active `LEADER` membership.
- The team creator is created as the initial Owner in the same database transaction as the team.
- The Owner may appoint or remove the one additional Leader.
- Ownership transfer is atomic: the recipient becomes `OWNER` and the previous Owner becomes `MEMBER`.
- The service rejects any change that would leave a team without an Owner or create more than one Leader.
- A user may be a member of multiple teams, with a different role in each.
- A newly created team begins with `boardProvisioningStatus: PENDING`; it becomes `READY` only after Task Service idempotently creates the default statuses.

##### Public operations

All routes below are reached through the gateway. Every route except signup, login, and the Google OAuth start/callback requires a valid bearer JWT.

| Method and route | Functional requirement | Authorisation |
| --- | --- | --- |
| `POST /auth/signup` | Register a unique username/email account with a securely hashed password. | Public |
| `POST /auth/login` | Validate password credentials and issue a JWT. | Public |
| `GET /auth/google` | Start Google sign-in. | Public |
| `GET /auth/google/callback` | Complete verified Google sign-in; create or link the Teamisty account when appropriate; issue a JWT/session response. | Public |
| `POST /auth/refresh` | Validate and rotate the refresh session; issue a new 15-minute access token. | Valid refresh cookie plus CSRF protection |
| `POST /auth/logout` | Revoke the current refresh session and clear its refresh cookie. | Valid refresh cookie plus CSRF protection |
| `GET /users/me` | Return the authenticated user's profile. | Authenticated user |
| `GET /users/me/teams` | List the caller's active teams and role in each. | Authenticated user |
| `POST /teams` | Create a team, its initial Owner membership, and a pending board-initialisation outbox record. The response includes board provisioning status. | Authenticated user |
| `GET /teams/{teamId}` | Return a non-deleted team, including its board provisioning status. | Active team member |
| `GET /teams/{teamId}/members` | List active team members and roles. | Active team member |
| `PATCH /teams/{teamId}/members/{userId}/role` | Owner appoints or removes the one additional Leader. | Owner only |
| `PATCH /teams/{teamId}/ownership` | Transfer ownership to an active member. | Owner only |
| `DELETE /teams/{teamId}/members/{userId}` | Remove a Member after the active-task safety check. A Leader may remove Members but never the Owner; an Owner may also remove the Leader. | Owner or Leader, subject to role rules |
| `DELETE /teams/{teamId}` | Soft-delete the team and immediately deny access to it and all team-scoped resources. It does not require an immediate per-record soft-delete of tasks or comments. | Owner only |
| `POST /teams/{teamId}/invitations` | Create a pending invitation for an existing registered user. | Owner or Leader |
| `GET /invitations` | List the caller's invitations. | Authenticated user |
| `PATCH /invitations/{invitationId}` | Accept or decline the caller's own pending invitation. | Intended invitee only |

Exact JSON request/response bodies are an API-contract decision. The routes and authorisation rules above are the current implementation baseline.

##### Invitation and membership workflow

1. An Owner or Leader invites a registered user who is not already an active member.
2. The service stores one `PENDING` invitation and its pending invitation-notification outbox record in the same transaction.
3. Only the invitee may accept or decline it.
4. Acceptance atomically creates one `MEMBER` membership and marks the invitation `ACCEPTED`.
5. Declined, accepted, and cancelled invitations cannot be transitioned again.

The service rejects duplicate pending invitations and invitations for existing active members. A user may accept invitations from multiple teams.

##### Required internal contracts and dependencies

| Direction | Contract | Requirement |
| --- | --- | --- |
| Task Service → User & Team Service | `GET /internal/teams/{teamId}/members/{userId}` | Return `userId`, `teamId`, `isActiveMember`, and role (`OWNER`, `LEADER`, or `MEMBER`) so Task Service can validate requester access and assignee eligibility. |
| User & Team Service → Task Service | `GET /internal/teams/{teamId}/members/{userId}/active-task-summary` | Before member removal, obtain the number of active assigned tasks. If non-zero, reject removal. |
| User & Team Service → Broker → Notification Service | `INVITATION_CREATED` event | Publish a durable event from the invitation-notification outbox. Notification Service consumes it idempotently for the invitee. |
| User & Team Service → Broker → Task Service | `TEAM_CREATED` event | Publish a durable event from the board-initialisation outbox. Task Service consumes it idempotently and creates `TODO`, `IN_PROGRESS`, and `DONE`. |
| Task Service → Broker → User & Team Service | `TEAM_BOARD_READY` event | After successful board initialisation, publish a durable event so User & Team Service marks the team's board status `READY`. |

For member removal, an active task is non-deleted and in a non-completed status. If the summary is greater than zero, return `409 Conflict`; if Task Service is unavailable, return `503 Service Unavailable` and do not modify the membership.

##### Expected error behaviour

| Situation | Response |
| --- | --- |
| Duplicate username or email | `409 Conflict` |
| Invalid password or Google sign-in failure | `401 Unauthorized` |
| Missing, invalid, or expired JWT | `401 Unauthorized` |
| Caller is not an active team member | `403 Forbidden` |
| Caller lacks Owner/Leader authority | `403 Forbidden` |
| Invitee does not exist | `404 Not Found` |
| Duplicate pending invitation or existing membership | `409 Conflict` |
| Attempt to create a second Leader | `409 Conflict` |
| Attempt to remove or demote the Owner | `403 Forbidden` or `409 Conflict` |
| Member has active assigned tasks | `409 Conflict` |
| Task Service unavailable for removal check | `503 Service Unavailable` |

#### Non-functional requirements

- **Security:** Hash passwords with bcrypt; never store plaintext passwords. Verify Google identity tokens through the provider flow. Do not expose password hashes, JWTs, OAuth credentials, or service secrets in API responses or logs.
- **Authorisation integrity:** Load the current membership for team-scoped actions; do not trust a client-supplied role or stale token role claim. Enforce ownership transfer and leadership changes atomically in a database transaction.
- **Data integrity:** Enforce unique username/email, one active membership per user/team, one pending invitation per user/team, one Owner per team, and at most one additional Leader using database constraints and transaction-safe checks.
- **Reliability:** Fail closed when identity, token validation, or the Task Service member-removal check cannot be completed. Failed invitation notification delivery must not undo a persisted invitation; the invitation and its pending delivery record are saved atomically, then delivery is observable and retryable through the broker. Team creation commits the team and its board-initialisation outbox record atomically; temporary Task Service failure leaves the board `PENDING` for broker redelivery rather than rolling back the team.
- **Deletion behaviour:** A deleted team is an access boundary: all team-scoped reads and writes must reject it, even if related task, comment, membership, or invitation records remain retained for history.
- **Observability:** Expose `GET /health` and `GET /metrics`. Write structured logs for signup/login success or failure, team creation, ownership/role changes, invitation lifecycle, member-removal attempts, and team deletion. Include correlation ID, route, safe user/team IDs, response status, and error code.
- **Metrics:** Record request count, errors, latency, login success/failure count, invitation outcomes, leadership changes, member-removal rejections, and Task Service dependency failures.
- **Testability:** Unit-test credential handling, role checks, ownership transfer, single-Leader enforcement, invitation transitions, and duplicate prevention. Integration-test all protected routes, multi-team role isolation, removal with zero/one/multiple active tasks, and safe failure when Task Service is unavailable.

### Task Service

#### Functional requirements

Task Service owns team board statuses, tasks, task comments, task lifecycle, and pending task-notification outbox records. It does not own users, teams, memberships, roles, invitations, or notification records.

##### Owned data and invariants

| Record | Required information and rules |
| --- | --- |
| Board status | Immutable ID; team ID; name; ordered position; `isDone` flag; audit timestamps. A team has one to five active statuses. |
| Task | Immutable ID; team ID; creator ID; required assignee ID while active; title; optional description/due date; status ID; `completedAt`; soft-delete fields; audit timestamps. A task never changes team. |
| Comment | Immutable ID; task ID; author ID; text content; soft-delete fields; created/updated timestamps. A deleted comment hides its text and is displayed as a `Comment deleted` placeholder. |
| Task-event outbox | Stable event ID; event type; task/team/recipient IDs; delivery payload; `PENDING`, `DELIVERED`, or `FAILED` state; attempt details and timestamps. |

- A new team must receive exactly three initial statuses: `TODO`, `IN_PROGRESS`, and `DONE`; `DONE` has `isDone: true`.
- Until default-status initialisation completes, task and status operations for that team return `409 Conflict` with a `BOARD_NOT_READY` error; the frontend uses the team's provisioning status to wait and retry.
- A team may have no more than five active statuses and may never have zero.
- A status containing active tasks cannot be removed until those tasks move to another status.
- Every active task has one assignee who is an active member of its team.
- Moving a task to a completed status sets `completedAt`; moving it out clears `completedAt`.
- If an Owner or Leader changes a status's `isDone` setting, Task Service updates `completedAt` consistently for every non-deleted task in that status as part of the same transaction.
- Soft-deleted tasks and comments are excluded from normal reads and cannot be modified.

##### Authorisation rules

- `OWNER` and `LEADER` have the same task and board permissions: create for any active member, edit/reassign/move/delete any team task, and configure board statuses.
- `MEMBER` can create a task only for themselves, edit/delete tasks they created, and move only tasks currently assigned to them.
- Every active team member can view team tasks and add/view comments.
- Only a comment's author can edit or soft-delete that comment.
- Task Service obtains current membership and role from User & Team Service; it never trusts a role or user ID supplied in the browser request body.

##### Public operations

All public routes require a valid bearer JWT and current active membership in the relevant team.

| Method and route | Functional requirement | Authorisation |
| --- | --- | --- |
| `POST /teams/{teamId}/tasks` | Create a task in the first ordered status. Owner/Leader may select any active assignee; a Member is automatically the assignee. | Active member; role rules apply |
| `GET /teams/{teamId}/tasks` | List non-deleted tasks for the team. | Active team member |
| `GET /tasks/{taskId}` | Return one non-deleted task. | Active member of its team |
| `PATCH /tasks/{taskId}` | Edit title, description, or due date. | Role rules apply |
| `PATCH /tasks/{taskId}/assignee` | Reassign a task to an active team member. | Owner or Leader |
| `PATCH /tasks/{taskId}/status` | Move a task to another active status in the same team. | Owner, Leader, or current assignee subject to role rules |
| `DELETE /tasks/{taskId}` | Soft-delete a task. | Role rules apply |
| `GET /teams/{teamId}/statuses` | List statuses in board order. | Active team member |
| `POST /teams/{teamId}/statuses` | Add a status when fewer than five statuses exist. | Owner or Leader |
| `PATCH /statuses/{statusId}` | Rename, reorder, or change completion meaning of a status. | Owner or Leader |
| `DELETE /statuses/{statusId}` | Remove an empty status while retaining at least one. | Owner or Leader |
| `GET /tasks/{taskId}/comments` | List non-deleted comments and deleted-comment placeholders. | Active member of the task's team |
| `POST /tasks/{taskId}/comments` | Add a non-empty comment. | Active member of the task's team |
| `PATCH /comments/{commentId}` | Edit a comment. | Comment author only |
| `DELETE /comments/{commentId}` | Soft-delete a comment. | Comment author only |

The frontend never supplies a trusted task creator or comment author; Task Service derives both from the authenticated identity. Exact JSON schemas, field limits, ordering, and pagination remain API-contract decisions.

##### Internal contracts and dependencies

| Direction | Contract | Requirement |
| --- | --- | --- |
| Task Service → User & Team Service | `GET /internal/teams/{teamId}/members/{userId}` | Validate requester access and role, as well as an assignee's active membership. Return `503` and make no mutation if unavailable. |
| User & Team Service → Task Service | `GET /internal/teams/{teamId}/members/{userId}/active-task-summary` | Return the count of assigned tasks that are non-deleted and not in a completed status. |
| User & Team Service → Broker → Task Service | `TEAM_CREATED` event | Idempotently create the initial `TODO`, `IN_PROGRESS`, and `DONE` statuses from the User & Team Service board-initialisation outbox, then publish `TEAM_BOARD_READY`. |
| Task Service → Broker → Notification Service | Task-notification event | Publish an idempotent notification event from a stored task-event outbox record. |

##### Notifications and outbox

Task Service creates outbox records in the same database transaction as the triggering task mutation.

| Event | Recipient |
| --- | --- |
| Task assigned | Assignee |
| Task reassigned | Previous and new assignees |
| Task moved to another status | Task creator |
| Task details edited | Current assignee |
| Task deleted | Current assignee |

The acting user is excluded from notifications. Notification delivery failure never rolls back the task change. A background publisher sends pending or retryable records to the broker using stable event IDs; Notification Service makes event consumption idempotent.

##### Expected error behaviour

| Situation | Response |
| --- | --- |
| Missing, invalid, or expired JWT | `401 Unauthorized` |
| Requester is not an active team member | `403 Forbidden` |
| Requester lacks task/comment/status permission | `403 Forbidden` |
| Proposed assignee is not an active team member | `400 Bad Request` |
| Invalid or deleted task, status, or comment | `404 Not Found` |
| Invalid task/comment data or cross-team status | `400 Bad Request` |
| Sixth status creation or removal of the final status | `409 Conflict` |
| Deleting a status that still has active tasks | `409 Conflict` |
| Team board is still provisioning | `409 Conflict` with `BOARD_NOT_READY` |
| User & Team Service unavailable | `503 Service Unavailable` |

#### Non-functional requirements

- **Security and authorisation:** Validate JWTs and request input; derive actor IDs from tokens; validate current membership for every team-scoped action; do not log JWTs or sensitive information.
- **Data integrity:** Use transactions for task mutations plus outbox creation. Enforce status ordering, the five-status limit, required active-task assignee, task/status team matching, and author-only comment updates/deletion.
- **Reliability:** Fail closed on unavailable membership validation. Delivery failures are retained for retry and measured without reversing successful task changes. Internal active-task summary queries must be authenticated and inaccessible to browsers.
- **Observability:** Expose `GET /health` and `GET /metrics`. Write structured logs for task/comment/status creation and changes, assignment, deletion, authorisation failure, cross-service failure, and notification delivery failure; include correlation ID, safe task/team/comment IDs, route, status, and error type.
- **Metrics:** Record request count, error count, latency, tasks created, status moves, task/comment soft deletions, User & Team dependency failures, pending outbox count, and notification-delivery failures.
- **Testability:** Unit-test all role rules, status capacity/reordering/removal, completed-state behaviour, comment author-only changes, and soft deletion. Integration-test task workflows, membership/assignee validation, active-task summaries, outbox persistence, retry-safe notification delivery, and unavailable dependency handling.

### Notification Service

#### Functional requirements

Notification Service owns in-app notification records, their read/unread state, and idempotent processing of notification-delivery requests. It does not own users, teams, memberships, tasks, comments, invitations, or the permission decisions that caused an event.

##### Owned data and invariants

| Field | Requirement |
| --- | --- |
| `id` | Immutable notification identifier. |
| `recipientId` | User receiving the notification. |
| `actorId` | User who caused the action, when applicable. |
| `teamId` | Relevant team identifier, when applicable. |
| `eventType` | Supported notification category. |
| `entityType`, `entityId` | Related `TASK` or `INVITATION` and its identifier. |
| `message` | Human-readable notification message. |
| `isRead`, `readAt` | Read state; a new notification is unread. |
| `sourceService`, `sourceEventId` | Producer identity and stable event ID used for idempotency. |
| `createdAt` | Creation timestamp. |

- The tuple `sourceService + sourceEventId + recipientId` is unique.
- Repeating the same delivered event leaves the existing notification unchanged rather than creating a duplicate.
- A user may read or mark read only notifications where they are the recipient.
- The service does not independently decide whether an event should notify a user; producers enforce their business rules, including excluding self-notifications.

##### Supported events

| Event type | Producer | Recipient |
| --- | --- | --- |
| `TEAM_INVITATION` | User & Team Service | Invited user |
| `TASK_ASSIGNED` | Task Service | Assignee |
| `TASK_REASSIGNED` | Task Service | Previous and new assignees |
| `TASK_STATUS_UPDATED` | Task Service | Task creator |
| `TASK_DETAILS_UPDATED` | Task Service | Current assignee |
| `TASK_DELETED` | Task Service | Current assignee |

Task comments do not create notification events unless a later product decision adds comment notifications.

##### Public operations

| Method and route | Functional requirement | Authorisation |
| --- | --- | --- |
| `GET /notifications` | List the authenticated user's notifications, newest first. | Authenticated user; own records only |
| `GET /notifications?unreadOnly=true` | List only the authenticated user's unread notifications. | Authenticated user; own records only |
| `GET /notifications/unread-count` | Return the authenticated user's unread count. | Authenticated user; own records only |
| `PATCH /notifications/{notificationId}/read` | Mark one owned notification as read. Repeating the request has no additional effect. | Recipient only |

Frontend requests use the user's JWT. Notification Service derives the recipient identity from the token and never accepts a client-supplied recipient ID for these operations.

##### Broker-consumer contract

Notification Service consumes durable `INVITATION_CREATED` events from User & Team Service and task-notification events from Task Service. Every event includes source service, stable source event ID, event type, recipient ID, actor ID when applicable, related team/entity IDs, and message.

The service authenticates to the broker using broker credentials. It validates the event, stores a new notification or detects its existing idempotency key, then acknowledges the broker message only after successful processing. Invalid or repeatedly failing events follow the broker retry/dead-letter policy.

Producers persist a stable event ID before publishing and reuse it on retry. Notification Service does not call User & Team Service or Task Service to validate normal event payloads; producers remain responsible for permission decisions and event correctness.

##### Notification access after deletion

Notification records remain historical records after their related team or task is deleted. They do not grant access to a task or team: when a frontend follows a notification target, the destination service must still validate current access and return an unavailable/access-denied result if the team, task, or membership has been deleted.

##### Frontend refresh behaviour

The frontend fetches notifications on page load and after a normal browser refresh. It also polls notification list/count endpoints every 60 seconds while the browser tab is visible. No dedicated refresh button and no WebSocket connection are required.

##### Expected error behaviour

| Situation | Response |
| --- | --- |
| Missing, invalid, or expired user JWT | `401 Unauthorized` |
| User tries to read or mark another user's notification | `404 Not Found` to avoid confirming its existence |
| Notification does not exist | `404 Not Found` |
| Invalid broker event | Consumer rejects the event; retry/dead-letter handling follows broker policy |
| Broker authentication or authorisation failure | Connection/consumer failure is logged and monitored |

#### Non-functional requirements

- **Security:** Validate JWTs for user routes and broker credentials for event consumption. Never expose records across recipients or log JWTs, API keys, broker credentials, or service secrets.
- **Idempotency and reliability:** Enforce the unique source-event/recipient key in the database. Accept at-least-once broker delivery safely; duplicate delivery leaves the existing record unchanged. Producer retry policy is defined by the producing service and the shared retry-policy decision.
- **Data integrity:** Store notification creation atomically with its idempotency record. Marking read is idempotent and sets `readAt` once.
- **Availability:** Notification Service failure must not make a successful task mutation or invitation fail after that originating record is committed. Producers retain and retry pending delivery work.
- **Observability:** Expose `GET /health` and `GET /metrics`. Use structured logs for creation, duplicate detection, read actions, user-authorisation failures, and broker-consumer failures; include correlation ID, safe notification/recipient IDs, source service/event ID, event type, route, and status.
- **Metrics:** Record request count, errors, latency, notifications created by event type, duplicate events prevented, unread count, broker-consumer failures, and dead-lettered events.
- **Testability:** Test every supported event, duplicate delivery, recipient isolation, unread filtering/count, idempotent mark-read behaviour, invalid event handling, broker-consumer authentication failure, and health/metrics endpoints.

## 6. Broker events, reliability, and failure handling

### RabbitMQ topology and event contract

RabbitMQ is the shared broker for asynchronous service communication. Publishers use transactional outbox records; a publisher confirms broker acceptance before marking an outbox item as delivered.

| Component | Purpose |
| --- | --- |
| `teamisty.events` durable topic exchange | Receives all domain events from service outbox publishers. |
| Board-initialisation queue | Delivers `TEAM_CREATED` to Task Service. |
| Board-ready queue | Delivers `TEAM_BOARD_READY` to User & Team Service. |
| Notification queue | Delivers invitation and task-notification events to Notification Service. |
| Dead-letter exchange/queues | Retains events that exhaust retry attempts for investigation and recovery. |

Every event uses this envelope:

```json
{
  "eventId": "uuid-v4",
  "eventType": "TEAM_CREATED",
  "occurredAt": "2026-11-17T10:30:00Z",
  "correlationId": "uuid-v4",
  "producer": "USER_TEAM_SERVICE",
  "data": {}
}
```

| Event | Required `data` |
| --- | --- |
| `TEAM_CREATED` | `teamId` |
| `TEAM_BOARD_READY` | `teamId` |
| `INVITATION_CREATED` | `invitationId`, `teamId`, `recipientId`, `actorId`, `message` |
| Task notification event | `taskId`, `teamId`, `recipientId`, `actorId`, `message` |

Each recipient receives a distinct notification event with a stable `eventId`. Consumers are idempotent by `eventId` (and notification recipient where applicable), acknowledge only after their database transaction succeeds, and preserve the correlation ID in logs.

### Retry and dead-letter policy

- Transient publish or consumer-processing failures retry at 1 minute, 5 minutes, 15 minutes, 1 hour, and 4 hours.
- After five failed attempts, an event goes to a dead-letter queue rather than being discarded.
- Dead-lettered events are logged, counted in metrics, and retained for manual inspection/replay.
- RabbitMQ queues/messages are durable and publishers use confirmation before treating publication as successful.

- A task mutation, invitation creation, or team creation and its pending outbound event are written atomically in the originating service's database.
- A producer-owned background publisher sends pending/retryable events to the broker.
- Successful task or invitation changes are retained even if notification delivery fails.
- Event consumers acknowledge broker messages only after successful processing and must process stable event IDs idempotently.
- Failed delivery attempts are logged and measured.
- Member removal fails safely with `503` when Task Service cannot confirm active-task count.
- No distributed transaction spans services.

## 7. API conventions

- REST/JSON APIs use explicit HTTP status codes.
- Successful creation returns `201`; invalid input returns `400`; invalid or missing authentication returns `401`; unauthorized action returns `403`; missing resources return `404`; rule conflicts return `409`; unavailable dependencies return `503`.
- Public resource IDs are UUID v4 strings.
- Timestamps use ISO 8601 UTC format, for example `2026-11-17T10:30:00Z`. Calendar dates use `YYYY-MM-DD` with no implicit timezone conversion.
- Error responses use `{ "error": { "code": "MACHINE_READABLE_CODE", "message": "Human-readable explanation", "details": [] }, "requestId": "correlation-id" }`. The `details` field is omitted when no field-level detail is useful.
- List endpoints use `page` and `limit`; the default limit is `20` and the maximum is `100`.
- User-controlled input is validated server-side using the Product Specification limits; request bodies do not supply trusted actor, creator, author, or role fields.

## 8. Network and runtime boundaries

- Only the gateway exposes public ports (`80` and `443`) in production.
- Backend services, PostgreSQL databases, and internal endpoints run on a private Docker network.
- The frontend receives one public API configuration value: `VITE_API_BASE_URL`.
- Local Docker Compose includes frontend, gateway, all services, and three databases.

## 9. Observability

Every service exposes `/health` and `/metrics`, emits structured logs, and propagates a correlation/request ID.

Logs include timestamp, service name, level, correlation ID, route, status code, relevant safe resource IDs, and error message. Passwords, password hashes, JWTs, and secrets must never be logged.

Prometheus/Grafana must expose availability, request rate, error rate, latency, and resource usage. Services also expose domain metrics such as login failures, task status changes, and notification delivery failures.

## 10. Open technical decisions

- Caddy or Nginx for the gateway.
- Central logging stack, metrics instrumentation library, registry, and backend hosting platform.

