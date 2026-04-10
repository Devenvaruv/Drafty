# Outlook Draft UI

Outlook Draft UI is a local full-stack app for signing into Outlook, loading inbox messages, and generating AI-assisted reply drafts.


## Tech Stack

### Frontend

- React 19
- Vite 8
- Axios


### Backend

- Node.js
- Express 5
- `express-session`
- `cors`
- `dotenv`
- Axios

### External dependencies

- Microsoft Identity Platform for OAuth login
- Microsoft Graph API for Outlook profile and mailbox data
- External AI service expected at `http://localhost:4000`

## Prerequisites

- Node.js and npm
- A Microsoft app registration with the required permissions
- A running AI service on `http://localhost:4000`

### Microsoft permissions

- `offline_access`
- `User.Read`
- `Mail.Read`
- `Mail.ReadWrite`

## Environment Setup

Create `server/.env` with:

```env
PORT=4001
CLIENT_URL=http://localhost:5174
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:4001/auth/microsoft/callback
MICROSOFT_AUTHORITY=https://login.microsoftonline.com/common
SESSION_SECRET=replace_with_a_secret
```

Notes:

- `CLIENT_URL` must match the frontend URL.
- This project currently expects the frontend on `http://localhost:5174`.
- The Azure app registration redirect URI must match `MICROSOFT_REDIRECT_URI`.

## Install Dependencies

From the repo root:

```powershell
cd .\server
npm install

cd ..\client
npm install
```

## Run Locally

Open two terminals.

### Terminal 1: backend

```powershell
cd .\server
node .\index.js
```

Backend URL: `http://localhost:4001`

### Terminal 2: frontend

```powershell
cd .\client
npm run dev -- --port 5174
```

Frontend URL: `http://localhost:5174`

## Quick Start

1. Start the backend on `4001`.
2. Start the frontend on `5174`.
3. Open the frontend in the browser.
4. Click `Connect Outlook`.
5. Sign in with Microsoft.
6. Open an inbox message.
7. Choose a tone.
8. Click `Generate Draft`.

## Readiness Checks

Run the included zero-dependency readiness check from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\readiness-check.ps1
```

If the AI service is not running yet:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\readiness-check.ps1 -SkipAiCheck
```

## Related Docs

- [SYSTEM_DESIGN.md](C:/Documents/Code/Extension%20test/outlook-draft-ui/SYSTEM_DESIGN.md)
- [TEST_CASES.md](C:/Documents/Code/Extension%20test/outlook-draft-ui/TEST_CASES.md)