# The sandbox image.
#
# Deliberately tiny: Node for JavaScript, Python for Python, and nothing else.
# Every package that is not here is one that cannot be reached by code trying to
# get out.
FROM node:22-alpine

# Python, and nothing that talks to a network. No curl, no wget, no git, no ssh.
RUN apk add --no-cache python3 \
 && adduser -D -H -u 10001 sandboxer

WORKDIR /app
COPY apps/sandbox/server.mjs apps/sandbox/harness.mjs apps/sandbox/harness.py ./

# Owned by root, run as somebody else: the code cannot rewrite the harness that
# is containing it.
RUN chown -R root:root /app && chmod -R 555 /app

USER sandboxer
EXPOSE 8790

# No package.json install step, so there are no dependencies to compromise.
CMD ["node", "server.mjs"]
