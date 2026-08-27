# THE BUILDER'S EYES — a browser in a room of its own.
#
# The founder's ruling (2026-08-27): the AI Builder must test its own work the
# way the CTO does — open it, screenshot it, look, fix, repeat — instead of
# handing an architect an untested screen and calling it done.
#
# Why this is NOT inside the code sandbox: that container has `internal: true`,
# no gateway, no route off the box at all — deliberately, because it runs an
# architect's own code. A browser must reach our frontend to render a page, so
# it needs a road, and a container that runs untrusted code must never have
# one. Two rooms, two rules.
#
# What this room can reach: the frontend container, and nothing else. No
# internet, no backend, no database, no credentials. It renders our own pages
# and hands back a picture.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# The base image ships the BROWSERS, not the npm package that drives them.
# Pinned to the image's own version so the driver and the browser can never
# disagree — a mismatch there fails at the worst possible moment, mid-look.
RUN npm install --no-save --omit=dev playwright@1.49.0

COPY apps/eyes/server.mjs ./

# Owned by root, run as somebody else — the same rule the code sandbox keeps.
RUN chown -R root:root /app && chmod -R 555 /app/server.mjs

USER pwuser
EXPOSE 8791

CMD ["node", "server.mjs"]
