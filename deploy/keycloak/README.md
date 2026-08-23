# Keycloak realm fixture

`aiser-realm.json` is a **local-development bootstrap fixture**, imported automatically by
`docker-compose.dev.ee.yml` and the quickstart `docker-compose.ee.yml`. It contains two values
that are intentionally public and must never be treated as real secrets:

- `clients[].secret` (`aiser-backend-dev-secret`) - the `aiser-backend` client secret
- `users[].credentials[].value` (`Demo1234!`) - the `demo` user's password

Both exist purely so a fresh `make dev-ee` / `make dev-ce` comes up with a working login and a
functioning backend-to-Keycloak service account, with zero setup. They are the same for every
clone of this repo.

## Do not reuse these in a real deployment

`docker-compose.ee.prod.yml` deliberately does **not** import this file. If you're standing up a
real (staging or production) Keycloak instance:

1. Boot Keycloak with `command: start-dev` (already the default in `docker-compose.ee.prod.yml`)
   and finish setup through the Admin Console at `http://<host>:8080`, or
2. Mount your own realm export at `/opt/keycloak/data/import/` and add `--import-realm` back to
   the `command:` yourself.
3. Either way, set a real `aiser-backend` client secret in Keycloak and pass the matching value as
   `KEYCLOAK_CLIENT_SECRET` to the server container - do not reuse `aiser-backend-dev-secret`.
4. Do not carry the `demo` user into a real realm.
