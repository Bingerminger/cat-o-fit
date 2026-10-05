# Security policy

Cat-O-Fit processes personal health and training data. Security and privacy are therefore
taken seriously – even though this is a small, open-source project.

## Reporting a vulnerability

Please report possible security vulnerabilities **confidentially** and **not** through
public issues:

- Use GitHub's **"Report a vulnerability"** feature (the *Security* tab of the
  repository → *Advisories*). Only the project maintainers can see the report.
- If the button is missing, please open an issue **without technical details** asking
  for a confidential contact – we will then get back to you with a private channel.

Please provide enough information to reproduce the problem (affected file/route, steps,
possible impact). Where possible you will receive a reply within **7 days**. Please allow
a reasonable period for a fix before details are made public (responsible disclosure).

## Supported versions

| Version | Security fixes |
|---|---|
| the current minor version on `main` (Docker tag `latest`) | ✅ |
| older versions | ❌ – please update |

## Security model

Cat-O-Fit is built to run on your **own, trusted network** (e.g. a Synology NAS on a home
network). What the app protects – and what it does not:

- **PIN and server session:** The server checks the PIN (SHA-256, failed attempts are
  limited) and then opens a session (HttpOnly cookie). PIN hashes never leave the
  server. You can change your own PIN only with your current one; a member's PIN can
  only be reset by an admin.
- **Private areas:** The server hands out cycle, labs and supplements only to the signed-in
  person themselves – not even to admins. They are not part of the family full backup.
- **All other areas** (training, plans, body values, nutrition …) follow the
  home-network model: every device that can reach the server can read and change them.
- **Admin actions** (creating members, changing roles, deleting members, replacing the
  family) require an admin sign-in at the server.
- **Other websites** cannot trigger changes: the server accepts write requests only as
  JSON and not from other sites. Strict Content Security Policy, no embedding in other
  sites.
- **Whoever runs the server** can read all data – it is stored unencrypted as JSON files in
  `data/`. This includes the private areas.

## Important operating notes

- **Reachable from the internet?** Then a sign-in in front of the app is **mandatory** (VPN,
  a reverse proxy with HTTPS and authentication, or the built-in Basic Auth of the
  Docker image) – see [Installation › Running outside your home network](docs/operations/installation.md#running-outside-your-home-network).
- `data/`, `tools/`, `test/`, `docs/` and repository files are blocked via `.htaccess`.
  Under **nginx** these rules do not apply; the required blocks are described in the [installation guide](docs/operations/installation.md).
- **Shared devices:** After signing out, data stays in the browser storage so that the
  app keeps working offline. In Settings, **"Shared device"** clears all personal data
  from the device when you sign out.
- **External connections:** only two optional services that can be switched off – the
  weather lookup at Open-Meteo (directly from the device, with the place or coordinates)
  and the nutrition search at Open Food Facts (from the server, with the ingredient name
  only; off by default for new profiles). See [CREDITS.md](CREDITS.md).

## Scope

The following are particularly relevant to security:

- The PHP backend under `api/` (sign-in/session in `auth.php`, file I/O,
  path handling, input validation, the `userId` allow-list).
- The separation of user data in multi-user operation (`data/users/<id>/`,
  `data/family/`) and the privacy of the private areas.
- The health ingest (`?action=health-ingest`, one key per person) and the
  calendar links (`?action=ics`, one key per person).
