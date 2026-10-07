import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Runtime inference reads the artifact from disk relative to the server cwd.
const model = "src/lib/strategies/default_with_features_gate/features/v3/model.json";
const target = path.join(".next/standalone", model);
await mkdir(path.dirname(target), { recursive: true });
await copyFile(model, target);
