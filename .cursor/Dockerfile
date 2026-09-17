# Cursor Cloud Agent base image for software-factory (Foundry).
# Do not COPY the project — Cursor clones the repo at agent start.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    sudo \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
