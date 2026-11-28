# Teamisty — Product Specification

**Status:** Review draft — proposed source of truth for product behaviour  
**Last updated:** 2026-11-16

## 1. Objective

Teamisty is a web-based task-management application for small teams. It lets users create teams, invite teammates, create and assign work, track tasks on a configurable board, and receive in-app notifications about relevant events.

The project must also demonstrate a practical DevOps workflow: independently deployable services, service-owned databases, REST communication, containerisation, automated testing and delivery, cloud deployment, centralised logging, and metrics monitoring.

## 2. Scope

### Included

- Account registration and password login, plus Google sign-in.
- Teams, memberships, Owner, Leader, and Member roles, and invitations.
- A configurable task board for each team.
- Task creation, assignment, editing, movement between statuses, and soft deletion.
- Task comments for team discussion on each task.
- Persisted in-app notifications with read/unread state.
- A React web frontend for the main user journeys.
- Three backend services, an API gateway, and one database owned by each service.

## 3. Users and roles

A user can belong to multiple teams. Their role is defined separately in every team.

| Role | Outcome |
| --- | --- |
| Owner | The single team owner. Has full team administration and controls team leadership. |
| Leader | An optional additional team administrator, appointed by the Owner. Manages members, invitations, board configuration, and tasks. |
| Member | Views shared work and manages work assigned to them. |
| Invited user | Views, accepts, or declines their own invitation. |

Rules:

- The team creator becomes its first Owner.
- A team has exactly one Owner and may have up to one additional active Leader.
- Only the Owner may appoint or remove the additional Leader.
- The Owner may transfer ownership to another active team member.
- Ownership transfer is atomic: the recipient becomes Owner and the previous Owner becomes a Member. Any existing additional Leader remains Leader.
- A team must always retain an active Owner.
- A user without a team sees onboarding and pending invitations after signing in.

## 4. Functional requirements

### Authentication

- The signup form asks for a unique username, a unique email, and a password. The display name defaults to the username for password signup. Users will be able to edit their display name in account settings in a later update.
- A user may sign in using Google OAuth. A verified Google email matching an existing account is linked after appropriate verification.
- Successful authentication creates a JWT-based session.
- Backend APIs enforce authentication and permissions; the frontend is not trusted for authorization.

### Shared validation rules

- Trim surrounding whitespace from names, titles, descriptions, comments, username, display name, and invitation lookup input. Required fields that become empty after trimming are rejected.
- All user-controlled input is validated by the backend and reflected by the frontend. Over-limit values are rejected rather than silently truncated.

| Input | Valid range |
| --- | --- |
| Username | 3–30 characters |
| Display name | 0–100 characters |
| Team name | 1–100 characters |
| Board status name | 1–50 characters |
| Task title | 1–200 characters |
| Task description | 0–5,000 characters |
| Comment text | 1–2,000 characters |
| Password | 8–72 characters |
| Invitation username/email lookup | 1–254 characters; email format is validated when email is used |

- Task due dates use a calendar date. When date fields are added later, their ordering rules must be explicitly defined before implementation.

### Teams and invitations

- An authenticated user can create a team and becomes its first Owner.
- An Owner or Leader can invite a registered user by username or email.
- An invitation is `PENDING`, `ACCEPTED`, `DECLINED`, or `CANCELLED`.
- Only the intended invitee can accept or decline an invitation.
- A user cannot have duplicate active membership or duplicate pending invitation for the same team.
- The Owner can appoint one active Member as Leader when there is no additional Leader.
- Only the Owner can remove or demote the additional Leader.
- The Owner can transfer ownership to another active member; the transfer retains exactly one Owner and no more than one additional Leader.
- A Leader cannot remove the Owner, transfer ownership, delete the team, or appoint/remove Leaders.
- Team deletion is a soft delete. It immediately hides the team and denies access to the team, its tasks, comments, memberships, and invitations while retaining historical data.
- Deleting a team does not need to individually mark every task or comment as deleted immediately; access is denied because their parent team is deleted.

### Task board and statuses

- Each team has one board with ordered status columns.
- A new team starts with `TODO`, `IN_PROGRESS`, and `DONE`.
- Leaders may add, rename, reorder, and remove statuses; Members may use but not configure them.
- A status with tasks cannot be removed until its tasks are moved elsewhere.
- A team must retain at least one status.
- `DONE` starts as a completed status; renaming it does not change its completed meaning.
- A team board has a maximum of five statuses.

### Tasks

A task has a title, optional description, team, creator, assignee, board status, optional due date, timestamps, and soft-deletion fields.

- Every active task has exactly one assignee.
- Leaders can create a task for any active team member.
- Members can create tasks only for themselves; the assignee is set automatically.
- All active team members can view non-deleted team tasks.
- Leaders can edit, reassign, move, and soft-delete any team task.
- Members can edit and soft-delete tasks they created, and can move tasks currently assigned to them.
- Moving into a completed status sets `completedAt`; moving out clears it.
- A task is overdue when its due date has passed and its current status is not completed.

### Task comments

- Every task provides a discussion area where active members of that task's team can view and add comments.
- A comment belongs to one task and records its author and creation time.
- Comments remain available as part of the task detail view.
- Only the user who created a comment may edit or delete it.

### Notifications

Notifications are persisted in-app records. A user can list their notifications and mark their own notifications as read.

| Event | Recipient |
| --- | --- |
| Team invitation | Invited user |
| Task assigned | Assignee |
| Task reassigned | Previous and new assignees |
| Task moved to another status | Task creator |
| Task details edited | Assignee |
| Task deleted | Assignee |

- The acting user is never notified about their own action.
- Reading an invitation notification does not accept or decline the invitation.
- A failed notification must not roll back a successfully saved team or task change.
- Notification retries must not create duplicates.

## 5. Permissions

| Action | Owner | Leader | Member |
| --- | --- | --- | --- |
| View team board and tasks | Yes | Yes | Yes |
| Configure board statuses | Yes | Yes | No |
| Create task | Any active assignee | Any active assignee | Self only |
| Edit task details | Any team task | Any team task | Tasks they created |
| Move task status | Any team task | Any team task | Tasks assigned to them |
| Reassign task | Yes | Yes | No |
| Soft-delete task | Any team task | Any team task | Tasks they created |
| View and add task comments | Yes | Yes | Yes |
| Edit/delete a task comment | Comments they created | Comments they created | Comments they created |
| Invite members | Yes | Yes | No |
| Remove Members | Yes | Yes, never the Owner | No |
| Appoint/remove Leader | Yes | No | No |
| Transfer team ownership | Yes | No | No |
| Soft-delete team | Yes | No | No |

## 6. Member removal and deletion rules

- A Member cannot leave, and an Owner or Leader cannot remove a Member, while that Member has active assigned tasks.
- Active tasks must first be reassigned or moved to a completed status.
- Completed tasks retain historical creator and assignee IDs.
- Removing a member soft-deactivates their membership and immediately revokes their team access while preserving membership and role history.
- Tasks are soft-deleted and cannot be read through normal team views or modified.
- Comments are soft-deleted; their content is hidden and the task discussion shows a `Comment deleted` placeholder to preserve the discussion timeline.
- Deleted items are not restored through the initial application interface.

## 7. Frontend scope and demonstration journey

Minimum screens are sign-up/login, team selection or onboarding, team task board, task creation/detail with comments, invitations, and notifications.

Primary demonstration:

1. Alice signs in and creates a team, becoming its Owner.
2. Alice invites Bob; Bob accepts the invitation.
3. Alice creates a task and assigns it to Bob.
4. Bob receives an in-app notification and moves the task through the board.
5. Logs and metrics show the request flow; an invalid assignee request is traced using a correlation ID.

## 8. Acceptance criteria

- A user can sign in, create or join a team, and see only teams they belong to.
- Permission checks work through direct API calls as well as the frontend.
- Tasks cannot be assigned to inactive or non-member users.
- Active team members can view and add comments on their team's tasks.
- Only a comment's creator can edit or delete it.
- Role and board rules above are enforced without partial changes.
- A notification is stored for each applicable event, without duplicates on retry.
- The primary journey runs through the deployed frontend and gateway.

## 9. Open product decisions

There are no remaining product-behaviour decisions currently identified.

