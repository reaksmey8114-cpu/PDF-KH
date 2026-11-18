# Security Specification: Document Master

## 1. Data Invariants
1. User Isolation: `/users/{userId}` can only be read, created, or updated by the authenticated, email-verified user matching `request.auth.uid == userId`.
2. Project Ownership: `/projects/{projectId}` requires `ownerId == request.auth.uid` on creation and forbids changing `ownerId` or `createdAt`.
3. Master Gate: `/projects/{projectId}/documents/{docId}` and `/projects/{projectId}/versions/{versionId}` verify via `get()` that the parent `/projects/{projectId}` exists and belongs to `request.auth.uid`.
4. Secure List Queries: `allow list` rules enforce `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()`.
5. Temporal Integrity & Path Hardening: `createdAt == request.time` on create, `updatedAt == request.time` on update, and IDs match `^[a-zA-Z0-9_\\-]+$`.
