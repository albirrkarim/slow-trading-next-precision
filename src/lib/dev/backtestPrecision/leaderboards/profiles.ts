import fs from "fs-extra";
import path from "path";
import { jsonFile } from "@/lib/system/storage";
import { isProfileMetricId } from "./leaves";
import type { LeaderboardProfile } from "./types";

/** Profiles live beside the per-entry files: storage/leaderboards/profiles.json. */
function filePath(): string {
  return path.join(
    process.env.BACKTEST_LEADERBOARDS_DIR?.trim() ||
      path.resolve("storage/leaderboards"),
    "profiles.json",
  );
}

/**
 * Built-in profiles — written on first list so users can edit or delete them.
 * Daily Income targets the "profit every day" goal: frequent closed trades,
 * high hit rate, smooth monthly compounding, and no dead months.
 */
const SEED_PROFILES: LeaderboardProfile[] = [
  {
    name: "Daily Income",
    t: 0,
    weights: {
      "leaderboard.sharpeRatio": 0.3,
      "leaderboard.tradesPerDay": 0.3,
      "leaderboard.winRate": 0.2,
      "leaderboard.monthlyGain.min": 0.2,
    },
  },
];

function isProfile(value: unknown): value is LeaderboardProfile {
  const profile = value as LeaderboardProfile | null;
  return (
    typeof profile === "object" &&
    profile !== null &&
    typeof profile.name === "string" &&
    profile.name.trim() !== "" &&
    typeof profile.weights === "object" &&
    profile.weights !== null
  );
}

/**
 * Validates a profile for upsert: a non-empty name plus at least one weight
 * over known metric leaf ids with finite |weight| ≤ 10.
 */
function validate(
  profile: unknown,
): { error?: string; profile?: LeaderboardProfile } {
  if (!isProfile(profile)) {
    return {
      error: 'Profile must be { name: string, weights: { "<leafId>": number } }.',
    };
  }
  const name = profile.name.trim();
  if (name.length === 0 || name.length > 64) {
    return { error: "Profile name must be 1-64 characters." };
  }
  const entries = Object.entries(profile.weights);
  if (entries.length === 0) {
    return { error: "Profile must weight at least one metric." };
  }
  const weights: Record<string, number> = {};
  for (const [id, raw] of entries) {
    const weight = Number(raw);
    if (!isProfileMetricId(id)) {
      return { error: `Unknown metric leaf "${id}".` };
    }
    if (!Number.isFinite(weight) || Math.abs(weight) > 10) {
      return { error: `Weight for "${id}" must be a finite number within ±10.` };
    }
    weights[id] = weight;
  }
  return { profile: { name, t: Date.now(), weights } };
}

/** Lists saved profiles, seeding the defaults when the file does not exist. */
async function list(): Promise<LeaderboardProfile[]> {
  const file = filePath();
  if (!(await fs.pathExists(file))) {
    await jsonFile.write.atomic(file, { profiles: SEED_PROFILES });
    return [...SEED_PROFILES];
  }
  try {
    const parsed = (await fs.readJson(file)) as { profiles?: unknown };
    return Array.isArray(parsed.profiles)
      ? parsed.profiles.filter(isProfile)
      : [];
  } catch {
    return [];
  }
}

/** Upserts a profile by name (case-insensitive match). */
async function save(
  profile: unknown,
): Promise<{ error?: string; profile?: LeaderboardProfile }> {
  const result = validate(profile);
  if (!result.profile) return result;
  const profiles = await list();
  const index = profiles.findIndex(
    (existing) =>
      existing.name.toLowerCase() === result.profile!.name.toLowerCase(),
  );
  if (index >= 0) profiles[index] = result.profile;
  else profiles.push(result.profile);
  await jsonFile.write.atomic(filePath(), { profiles });
  return result;
}

/** Deletes a profile by name (case-insensitive); false when not found. */
async function remove(name: string): Promise<boolean> {
  const profiles = await list();
  const remaining = profiles.filter(
    (profile) => profile.name.toLowerCase() !== name.trim().toLowerCase(),
  );
  if (remaining.length === profiles.length) return false;
  await jsonFile.write.atomic(filePath(), { profiles: remaining });
  return true;
}

const leaderboardProfiles = {
  filePath,
  list,
  remove,
  save,
} as const;

export default leaderboardProfiles;
