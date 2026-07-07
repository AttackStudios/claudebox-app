# ClaudeBox

A self-hosted multiplayer game platform: a hub of original 3D games (Feather
Friends, Backpacking, Obby, Wibit, Restaurant Sim 2, Playground), custom
avatars, friends & presence, a Stars/Bits rewards economy, and ClaudeBox
Studio (a level editor whose saves go live in real games).

## Run it

    npm ci && npm start          # http://localhost:8787

## Cloud deploy

Build with the included Dockerfile (the server honors $PORT). For persistent
data on ephemeral-disk hosts, set UPSTASH_REDIS_REST_URL and
UPSTASH_REDIS_REST_TOKEN — data/ then mirrors to that Redis and is restored
on boot. Without those vars it just uses local files.
