# Test Cases


## How to run

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\readiness-check.ps1
```

Useful variants:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\readiness-check.ps1 -SkipAiCheck
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\readiness-check.ps1 -SkipClientChecks
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\readiness-check.ps1 -KeepStartedServer
```

## What the script tests

1. Repository structure exists
Pass condition: both `client` and `server` folders are present.

2. Server env file is complete
Pass condition: `server/.env` exists and includes:
`PORT`, `CLIENT_URL`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_AUTHORITY`, `SESSION_SECRET`

3. Dependencies are already installed
Pass condition: `client/node_modules` and `server/node_modules` both exist.

4. Client lint passes
Pass condition: `npm run lint` succeeds in `client`.

5. Client build passes
Pass condition: `npm run build` succeeds in `client`.

6. Backend can start
Pass condition: the script can either reuse an already running server on `http://localhost:4001` or start `server/index.js` itself.

7. Backend health route works
Pass condition: `GET /test` returns `backend is working`.

8. Auth status route works
Pass condition: `GET /auth/microsoft/status` returns JSON with an `authenticated` field.

9. Protected profile route is actually protected
Pass condition: `GET /me` returns `401` before login.

10. Protected messages route is actually protected
Pass condition: `GET /outlook/messages` returns `401` before login.

11. Microsoft OAuth start route is valid
Pass condition: `GET /auth/microsoft/start` returns a redirect to `login.microsoftonline.com`.

12. AI service is reachable
Pass condition: `POST http://localhost:4000/chat` returns `200`.

## Manual checks

These are not included in the script because they depend on a real Microsoft login and live mailbox data:

1. Sign in through Microsoft
Pass condition: after login, the browser returns to the client app.

2. Inbox loads after login
Pass condition: the left panel shows real Outlook messages.

3. Open a message
Pass condition: the selected message body loads on the right.

4. Generate a draft
Pass condition: clicking `Generate Draft` fills the draft textarea.

5. Logout
Pass condition: the app returns to the connect screen.
