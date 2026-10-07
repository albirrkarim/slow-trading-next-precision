import fs from "node:fs";
import path from "node:path";

/** Creates matching terminal/file logs with timestamps and elapsed seconds. */
function create(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a");
  const started = Date.now();
  let closed = false;
  return {
    log: (message: string) => {
      const line = `[${new Date().toISOString()} +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`;
      console.log(line);
      if (!closed) fs.writeSync(fd, `${line}\n`);
    },
    close: () => { if (!closed) { closed = true; fs.closeSync(fd); } },
  };
}

const logging = { create } as const;
export default logging;
