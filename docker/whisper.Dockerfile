# Pubblica whisper.cpp già compilato per l'immagine di ORION (docker/whisper.Dockerfile), una volta
# per versione: così chi costruisce ORION non compila niente.
name: Whisper

on:
  push:
    branches: [master]
    paths: [docker/whisper.Dockerfile]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  whisper:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Versione e nome dell'immagine
        id: v
        run: |
          VERSIONE=$(sed -n -E 's/^ARG WHISPER_VERSIONE=(.+)$/\1/p' docker/whisper.Dockerfile)
          [[ $VERSIONE =~ ^v[0-9]+(\.[0-9]+){1,3}$ ]] || { echo "Versione non valida: $VERSIONE"; exit 1; }
          echo "versione=$VERSIONE" >> "$GITHUB_OUTPUT"
          echo "immagine=ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/orion-whisper" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: docker
          file: docker/whisper.Dockerfile
          push: true
          tags: ${{ steps.v.outputs.immagine }}:${{ steps.v.outputs.versione }}
          labels: |
            org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}
