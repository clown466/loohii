# Frontend API Integration

The Vite frontend reads the backend base URL from `VITE_API_URL`. When it is empty, API requests use same-origin relative paths such as `/api/projects`.

Recommended production setup:

```env
VITE_API_URL=
```

Deploy the frontend and reverse proxy `/api` and `/socket.io` on the same domain to the backend. For the hosted domain, `VITE_API_URL` can also be set explicitly:

```env
VITE_API_URL=https://loohii.com
```

During Vite development, `/api` and `/socket.io` are proxied to `VITE_DEV_API_PROXY`, or to `http://localhost:3001` when that variable is empty.

```env
VITE_DEV_API_PROXY=http://localhost:3001
```

Authentication does not fall back to a local fake user after API failures. Login and registration errors are returned to the UI. Offline demo auth is only enabled when explicitly requested:

```env
VITE_AUTH_MOCK_MODE=true
```

## Auth

Preferred endpoints:

- `POST /api/auth/sign-in`
- `POST /api/auth/sign-up`
- `PATCH /api/auth/me`

Legacy fallback:

- `POST /api/login`

The frontend stores the returned bearer token in `localStorage` under `loohii-api-token` and sends it as the `Authorization` header. Failed login or registration requests should surface the backend error message.

## Projects

Preferred endpoints:

- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`

Legacy fallback:

- `POST /api/project/getProject`
- `POST /api/project/addProject`
- `POST /api/project/editProject`
- `POST /api/project/delProject`

The store still exposes synchronous `addProject`, `updateProject`, and `deleteProject` methods for existing UI pages. Mutations update local state first, then attempt the backend request.

## Agent Messages

Preferred endpoint:

- `POST /api/agent/messages`

Request shape:

```json
{
  "content": "继续生成剩余分镜",
  "projectId": "optional-project-id",
  "conversationId": "optional-conversation-id",
  "context": {}
}
```

Response shape:

```json
{
  "id": "assistant-message-id",
  "content": "assistant response",
  "metadata": {
    "progress": 50,
    "imageUrl": "https://example.com/image.png",
    "actions": [{ "label": "Open", "action": "open" }]
  }
}
```

If the backend response is unavailable, the agent store keeps using the existing mock response map.

## Canvas Scenes

Preferred endpoints:

- `GET /api/canvas/scenes/:projectId/:sceneId`
- `PUT /api/canvas/scenes/:projectId/:sceneId`

Scene payload:

```json
{
  "projectId": "project-id",
  "sceneId": "default",
  "nodes": [],
  "edges": [],
  "updatedAt": "2026-05-18T00:00:00.000Z"
}
```

Legacy production fallback is available for numeric IDs:

- `POST /api/production/getFlowData`
- `POST /api/production/saveFlowData`

The canvas store also saves the active local scene to `localStorage` using `loohii-canvas:<projectId>:<sceneId>`.
