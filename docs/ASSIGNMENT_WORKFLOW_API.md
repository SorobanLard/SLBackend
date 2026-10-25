# Assignment Submission and Review API

## Overview

This API covers the practical-assignment workflow for SorobanLard lessons:

- Instructors (or admins) create one assignment per lesson.
- Students upload their practical work (photo, video, document) and submit it.
- Instructors review submissions and approve or reject them with feedback.
- The system notifies instructors on submission and students on review.

Related code:

- `src/modules/assignments/assignments.controller.ts`
- `src/modules/assignments/assignments.service.ts`
- `src/modules/assignments/dto/create-assignment.dto.ts`
- `src/modules/assignments/dto/review-assignment.dto.ts`
- `src/modules/assignments/dto/pending-submissions-query.dto.ts`
- `src/modules/uploads` — file upload endpoint used before submitting

---

## Status model

`AssignmentSubmission.status` is an `AssignmentStatus` enum:

| Value | Meaning |
|---|---|
| `PENDING` | Defined in the schema for “student has not submitted yet”; no row exists until the first submission, so it is effectively unused. |
| `SUBMITTED` | Student submitted (or resubmitted) and the work is **under review**. There is no separate `UNDER_REVIEW` enum value. |
| `APPROVED` | Instructor approved. Terminal: the student cannot resubmit. |
| `REJECTED` | Instructor rejected. Student may resubmit, which moves it back to `SUBMITTED`. |

```
No row (conceptually PENDING)
        │  POST /assignments/:id/submit
        ▼
    SUBMITTED ──review approved──► APPROVED (terminal)
        │
        └──review rejected──► REJECTED
                                 │  POST /assignments/:id/submit
                                 ▼
                             SUBMITTED
```

Every submission upsert updates `submittedAt`; review sets `reviewedAt` and
`feedback`. A submission is unique per `(assignmentId, studentId)`.

---

## Authentication

All assignment endpoints require a valid JWT:

```http
Authorization: Bearer <JWT>
```

Create/review/pending-review routes additionally require `INSTRUCTOR` or
`ADMIN` (`RolesGuard`), and the service enforces course ownership for
instructors.

---

## Endpoints

All paths are prefixed with `/api/v1`.

### 1. Create an assignment

**POST** `/assignments` (INSTRUCTOR or ADMIN)

Each lesson can have only one assignment (`Assignment.lessonId` is unique).

#### Request body

```json
{
  "lessonId": "1f0b6f1e-4f8c-4d6f-9a63-3b9f2c7d1a20",
  "title": "Practical Sewing Task",
  "description": "Create a sewn garment piece using the techniques from this lesson.",
  "instructions": "Take a clear photo of the finished piece and upload it."
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `lessonId` | string | Yes | Must reference an existing lesson |
| `title` | string | Yes | 1–255 characters |
| `description` | string | Yes | 1–2000 characters |
| `instructions` | string | No | Max 5000 characters |

#### Response (201 Created)

```json
{
  "id": "9a1c2e3f-4b5d-6e7f-8a9b-0c1d2e3f4a5b",
  "lessonId": "1f0b6f1e-4f8c-4d6f-9a63-3b9f2c7d1a20",
  "title": "Practical Sewing Task",
  "description": "Create a sewn garment piece using the techniques from this lesson.",
  "instructions": "Take a clear photo of the finished piece and upload it.",
  "createdAt": "2026-10-21T12:00:00.000Z"
}
```

#### Errors

| Status | Reason |
|---|---|
| `401 Unauthorized` | Missing/invalid JWT |
| `403 Forbidden` | Not an instructor/admin, or instructor does not own the lesson's course |
| `404 Not Found` | Lesson does not exist |
| `409 Conflict` | The lesson already has an assignment (unique constraint) |

**Ownership rule:** a non-admin must be the course instructor by
`Course.instructorAddress === user.id` **or** `Course.instructor.id === user.id`.
Admins bypass this check.

---

### 2. Get the assignment for a lesson

**GET** `/assignments/lesson/:lessonId` (any authenticated user)

Returns the assignment and all of its submissions, including each student's
name and Stellar address. This route does not restrict access to the course
owner; it is available to any authenticated user.

#### Response (200 OK)

```json
{
  "id": "9a1c2e3f-4b5d-6e7f-8a9b-0c1d2e3f4a5b",
  "lessonId": "1f0b6f1e-4f8c-4d6f-9a63-3b9f2c7d1a20",
  "title": "Practical Sewing Task",
  "description": "Create a sewn garment piece using the techniques from this lesson.",
  "instructions": "Take a clear photo of the finished piece and upload it.",
  "createdAt": "2026-10-21T12:00:00.000Z",
  "submissions": [
    {
      "id": "sub-1",
      "assignmentId": "9a1c2e3f-4b5d-6e7f-8a9b-0c1d2e3f4a5b",
      "studentId": "student-1",
      "submissionUrl": "uploads/assignments/garment.jpg",
      "notes": "Used the French seam from the video.",
      "status": "SUBMITTED",
      "feedback": null,
      "submittedAt": "2026-10-21T13:00:00.000Z",
      "reviewedAt": null,
      "student": {
        "name": "Jane Doe",
        "stellarAddress": "G..."
      }
    }
  ]
}
```

#### Errors

| Status | Reason |
|---|---|
| `404 Not Found` | No assignment exists for the lesson |

---

### 3. Submit practical work

**POST** `/assignments/:id/submit` (any authenticated user)

Upload the file first with `POST /uploads/assignment` (max 100 MB), then send the
resulting URL here.

#### Request body

```json
{
  "submissionUrl": "uploads/assignments/garment.jpg",
  "notes": "Used the French seam from the video."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `submissionUrl` | string | Yes | URL/path returned by the upload endpoint |
| `notes` | string | No | Student notes for the reviewer |

#### Response (200 OK)

The created/updated submission, including its assignment and lesson/course:

```json
{
  "id": "sub-1",
  "assignmentId": "9a1c2e3f-4b5d-6e7f-8a9b-0c1d2e3f4a5b",
  "studentId": "student-1",
  "submissionUrl": "uploads/assignments/garment-v2.jpg",
  "notes": "Updated with the requested changes.",
  "status": "SUBMITTED",
  "feedback": null,
  "submittedAt": "2026-10-21T14:30:00.000Z",
  "reviewedAt": null,
  "assignment": {
    "id": "9a1c2e3f-4b5d-6e7f-8a9b-0c1d2e3f4a5b",
    "title": "Practical Sewing Task",
    "lesson": {
      "module": {
        "course": { "...": "..." }
      }
    }
  }
}
```

Behavior:

- First submission creates a row with `status = SUBMITTED`.
- A resubmission (`SUBMITTED` or `REJECTED`, same student + assignment) replaces
  `submissionUrl`/`notes`, sets `status = SUBMITTED`, and refreshes `submittedAt`.
  Previous feedback is left untouched until the next review.
- An `APPROVED` submission cannot be resubmitted.
- The instructor is notified (`ASSIGNMENT_SUBMITTED`) if a user with the course's
  `instructorAddress` exists.

#### Errors

| Status | Reason |
|---|---|
| `403 Forbidden` | Submission is already `APPROVED` |
| `404 Not Found` | Assignment does not exist (Prisma relation failure) |

> Note: this route uses an inline body type rather than a DTO class, so the
> global `ValidationPipe` does not enforce field validation here. Clients should
> still send both fields as documented.

---

### 4. Review a submission

**POST** `/assignments/submissions/:id/review` (INSTRUCTOR or ADMIN)

#### Request body

```json
{
  "approved": true,
  "feedback": "Excellent finishing on the seams. Approved."
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `approved` | boolean | Yes | `true` → `APPROVED`, `false` → `REJECTED` |
| `feedback` | string | Yes | 1–2000 characters |

#### Response (200 OK)

```json
{
  "id": "sub-1",
  "assignmentId": "9a1c2e3f-4b5d-6e7f-8a9b-0c1d2e3f4a5b",
  "studentId": "student-1",
  "submissionUrl": "uploads/assignments/garment.jpg",
  "notes": "Used the French seam from the video.",
  "status": "APPROVED",
  "feedback": "Excellent finishing on the seams. Approved.",
  "submittedAt": "2026-10-21T13:00:00.000Z",
  "reviewedAt": "2026-10-21T15:00:00.000Z"
}
```

Behavior:

- Sets `status`, `feedback`, and `reviewedAt`.
- Notifies the student with `ASSIGNMENT_APPROVED` or `ASSIGNMENT_REJECTED`.
- The feedback text is included in the rejection notification.

#### Errors

| Status | Reason |
|---|---|
| `401 Unauthorized` | Missing/invalid JWT |
| `403 Forbidden` | Not instructor/admin, or instructor does not own the course |
| `404 Not Found` | Submission does not exist |
| `400 Bad Request` | `approved` not boolean, or feedback empty/too long |

**Ownership rule:** a non-admin must match
`Course.instructorAddress === user.id` **or** `Course.instructor.id === user.id`.

> There is no state guard on review: the service will update a submission even
> if it is already `APPROVED` or `REJECTED`. Clients should only review
> `SUBMITTED` items from the pending list.

---

### 5. Student's submissions

**GET** `/assignments/my/submissions` (any authenticated user)

Returns all submissions for the authenticated user, newest first, with each
assignment and lesson:

```json
[
  {
    "id": "sub-1",
    "assignmentId": "9a1c...",
    "studentId": "student-1",
    "submissionUrl": "uploads/assignments/garment.jpg",
    "notes": "Used the French seam from the video.",
    "status": "REJECTED",
    "feedback": "Please show the inside seam more clearly.",
    "submittedAt": "2026-10-21T13:00:00.000Z",
    "reviewedAt": "2026-10-21T15:00:00.000Z",
    "assignment": {
      "id": "9a1c...",
      "title": "Practical Sewing Task",
      "lesson": { "...": "..." }
    }
  }
]
```

---

### 6. Instructor's pending reviews

**GET** `/assignments/instructor/pending?page=1&limit=20`
(INSTRUCTOR or ADMIN)

Returns submissions with `status = SUBMITTED` for courses whose
`instructorAddress` matches the authenticated user's Stellar address, oldest
first. Includes the student's name and Stellar address.

#### Query parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `page` | number | `1` | Min 1 |
| `limit` | number | `20` | 1–100 |

#### Response (200 OK)

```json
{
  "data": [
    {
      "id": "sub-1",
      "assignmentId": "9a1c...",
      "studentId": "student-1",
      "submissionUrl": "uploads/assignments/garment.jpg",
      "notes": "Used the French seam from the video.",
      "status": "SUBMITTED",
      "feedback": null,
      "submittedAt": "2026-10-21T13:00:00.000Z",
      "reviewedAt": null,
      "assignment": { "...": "..." },
      "student": {
        "name": "Jane Doe",
        "stellarAddress": "G..."
      }
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

> The filter uses the JWT user's `stellarAddress`. An admin account without a
> Stellar address will see an empty list; use an instructor-scoped token (or
> query the course's submissions through `GET /assignments/lesson/:lessonId`).

---

## End-to-end example

```
1. Instructor creates the assignment
   POST /api/v1/assignments
   { "lessonId": "...", "title": "...", "description": "..." }

2. Student uploads the practical work
   POST /api/v1/uploads/assignment        (multipart/form-data)
   → { "url": "uploads/assignments/garment.jpg" }

3. Student submits
   POST /api/v1/assignments/<assignmentId>/submit
   { "submissionUrl": "uploads/assignments/garment.jpg", "notes": "..." }
   → status: SUBMITTED
   → instructor notification: ASSIGNMENT_SUBMITTED

4. Instructor lists pending work
   GET /api/v1/assignments/instructor/pending?page=1&limit=20

5a. Instructor approves
    POST /api/v1/assignments/submissions/<submissionId>/review
    { "approved": true, "feedback": "Great work" }
    → status: APPROVED
    → student notification: ASSIGNMENT_APPROVED

5b. Instructor rejects
    POST /api/v1/assignments/submissions/<submissionId>/review
    { "approved": false, "feedback": "Please retake the photo" }
    → status: REJECTED
    → student notification: ASSIGNMENT_REJECTED

6. Student resubmits after rejection
   POST /api/v1/assignments/<assignmentId>/submit
   → status: SUBMITTED (back in the instructor queue)
```

---

## Notification types

| Event | Recipient | NotificationType |
|---|---|---|
| Submission created/resubmitted | Instructor | `ASSIGNMENT_SUBMITTED` |
| Review approved | Student | `ASSIGNMENT_APPROVED` |
| Review rejected | Student | `ASSIGNMENT_REJECTED` |

Notifications are best-effort inbox records created through
`NotificationsService.notifyUser`; they do not affect the submission status.
