# Infra

This directory is the short operational map for Docker, local development, and
Hetzner VPS production.

## Source Of Truth

| Area                      | Source                                  |
| ------------------------- | --------------------------------------- |
| App image                 | Root `Dockerfile`                       |
| Local Compose             | Root `docker-compose.yml`               |
| Production Compose        | `infra/hetzner/compose.*.yml`           |
| Production scripts        | `infra/hetzner/scripts/*.sh`            |
| Production runtime mirror | `/opt/mmbot` on the VPS                 |
| Local DB tunnel           | `infra/hetzner/local/open-db-tunnel.sh` |

Root `docker-compose.yml` is a local development wrapper. It keeps the same
service names and config mount paths as Hetzner production, but stays
self-contained so local Compose does not require production-only secrets.

## Read Next

- [Docker](./docker.md): local container usage and image ownership.
- [Hetzner](./hetzner.md): production runtime model and operations.
