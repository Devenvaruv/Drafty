# System Design

This document covers architecture, system boundaries, and runtime request flow. 

## Architecture Overview

```text
+---------------------------------------------------------------------------------------------------------------------------+
|                                       OUTLOOK DRAFT UI                                                                    |
+---------------------------------------------------------------------------------------------------------------------------+
|
|  +---------------------------+            [A] GET /, JS, CSS            +-----------------------------------------------+
|  | Browser + React runtime   | ---------------------------------------> | Vite dev server / static host                 |
|  | localhost:5174            | <--------------------------------------- | serves index.html, App.jsx bundle, CSS        |
|  |                           |                                          +-----------------------------------------------+
|  | Functions in App.jsx      |
|  | - checkAuth()             |            [B] GET  /auth/microsoft/status
|  | - connectOutlook()        |            [C] GET  /me
|  | - openMessage(id)         |            [D] GET  /outlook/messages
|  | - generateDraft()         |            [E] GET  /outlook/messages/:id
|  | - logout()                |            [F] GET  /auth/logout
|  |                           |            [G] GET  /auth/microsoft/start   (browser navigation)
|  |                           |            [J] POST /chat classifier        (direct to AI)
|  |                           |            [L] POST /chat reply             (direct to AI)
|  +-------------+-------------+
|                |
|                | withCredentials=true, browser sends session cookie
|                v
|  +-------------+--------------------------------------------------------------------------------------------------------+
|  | Express backend :4001                                                                                                |
|  | file: server/index.js                                                                                                |
|  | middleware: express.json, cors(origin=CLIENT_URL, credentials=true), express-session                                 |
|  |                                                                                                                      |
|  | in-memory session object:                                                                                            |
|  | req.session.microsoft = { accessToken, refreshToken, expiresIn }                                                     |
|  |                                                                                                                      |
|  | browser-facing routes:                                                                                               |
|  | [B] GET /auth/microsoft/status                                                                                       |
|  | [F] GET /auth/logout                                                                                                 |
|  | [G] GET /auth/microsoft/start                                                                                        |
|  | [H] GET /auth/microsoft/callback?code=...                                                                            |
|  | [C] GET /me                                                                                                          |
|  | [D] GET /outlook/messages                                                                                            |
|  | [E] GET /outlook/messages/:id                                                                                        |
|  +------+------+-------------------------------------------------------------+------------------------------------------+
|         |                                                                    |
|         | [I] 302 redirect browser to Microsoft /authorize                   | [K] POST token exchange to Microsoft
|         |                                                                    |
|         v                                                                    v
|  +------+-----------------------------------+                    +-----------+------------------------------------------+
|  | Microsoft Identity Platform              |                    | Microsoft Graph API                                  |
|  | login.microsoftonline.com                |                    | graph.microsoft.com/v1.0                             |
|  | - GET  /oauth2/v2.0/authorize            |                    | - [M] GET /me                                        |
|  | - POST /oauth2/v2.0/token                |                    | - [N] GET /me/messages?$top=10&$select=...           |
|  +------+-----------------------------------+                    | - [O] GET /me/messages/:id                           |
|         ^                                                        +------------------------------------------------------+
|         |
|         | browser redirected back after login
|         | [H] GET /auth/microsoft/callback?code=...
|         |
|  +------+----------------------------------+
|  | External AI service :4000               |
|  | endpoint used by browser: POST /chat    |
|  |                                         |
|  | [J] classifier call                     |
|  | body = {                                |
|  |   agentSlug: "email_classifier",        |
|  |   message: emailChainText               |
|  | }                                       |
|  |                                         |
|  | [L] reply generation call               |
|  | body = {                                |
|  |   agentSlug: "<replyAgentSlug>",        |
|  |   message: emailChainText               |
|  | }                                       |
|  +-----------------------------------------+
|
|  ORDER OF OPERATIONS
|  [A] Browser loads frontend assets
|  [B] React asks backend whether a session exists
|  [C] If session exists, React loads profile
|  [D] If session exists, React loads inbox summaries
|  [G] If no session, browser navigates to backend login start route
|  [I] Backend redirects browser to Microsoft authorize
|  [H] Microsoft sends browser back with auth code
|  [K] Backend exchanges code for token and saves it in session
|  [M][N][O] Backend uses access token to call Microsoft Graph
|  [E] React loads selected message detail
|  [J] React classifies selected email through AI service
|  [L] React generates final reply through AI service
|  [F] React logs out and backend destroys session
+---------------------------------------------------------------------------------------------------------------------------+
```

## Runtime Flow

### App Startup And Auth Check

When the page loads, the React app does this:

```text
Browser opens app
   |
   v
React App mounts
   |
   v
GET http://localhost:4001/auth/microsoft/status
withCredentials: true
   |
   +--> if authenticated = false
   |      show "Connect Outlook"
   |
   +--> if authenticated = true
          in parallel:
          GET /me
          GET /outlook/messages
```

### Microsoft Login Flow

```text
[User clicks "Connect Outlook"]
            |
            v
[Browser navigates to GET /auth/microsoft/start on Express]
            |
            v
[Express builds Microsoft authorize URL]
            |
            v
[Browser is redirected to Microsoft login]
            |
            v
[User signs in and grants consent]
            |
            v
[Microsoft redirects browser to /auth/microsoft/callback?code=...]
            |
            v
[Express exchanges code for access token + refresh token]
            |
            v
[Express stores tokens in req.session.microsoft]
            |
            v
[Express redirects browser back to CLIENT_URL /]
            |
            v
[React app loads again and auth status is now true]
```


## Draft Generation


### Draft Generation Steps

When the user clicks `Generate Draft`, the frontend:

1. Reads the selected email subject
2. Reads sender name and sender address
3. Reads the HTML body
4. Strips HTML into plain text
5. Builds one text blob called `emailChainText`
6. Sends that text to the AI service for classification
7. Maps classifier result + selected tone to a reply agent slug
8. Calls the AI service again to generate the final reply
9. Puts the generated reply into the textarea

### Reply Agent Mapping

The frontend supports 3 tone choices:

- `professional`
- `friendly`
- `inquisitive`

The classifier supports 3 message categories:

- `vague_request`
- `follow_up`
- `post_meeting`

That creates 9 possible reply agents:

```text
vague_request + professional  -> vague_request_professional
vague_request + friendly      -> vague_request_friendly
vague_request + inquisitive   -> vague_request_inquisitive

follow_up + professional      -> follow_up_professional
follow_up + friendly          -> follow_up_friendly
follow_up + inquisitive       -> follow_up_inquisitive

post_meeting + professional   -> post_meeting_professional
post_meeting + friendly       -> post_meeting_friendly
post_meeting + inquisitive    -> post_meeting_inquisitive
```

If classification parsing fails, the app falls back to:

```text
vague_request_professional
```