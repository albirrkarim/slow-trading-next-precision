# Slow Trading

see [docs/PRECISION/_PRECISION.md](./docs/PRECISION/_PRECISION.md) for the
architecture backbone and [docs/SPECS/_SPECS.md](./docs/SPECS/_SPECS.md) for
the behavioral specification.

Try to debug memory consumtion

```bash
PORT=3010 \
HOSTNAME=0.0.0.0 \
NODE_ENV=production \
node --inspect=127.0.0.1:9230 --max-old-space-size=192 .next/standalone/server.js
```

SEE IN GUI

```
chrome://inspect/#devices
```
