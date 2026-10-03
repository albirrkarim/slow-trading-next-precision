/** localStorage key remembering the last selected leaderboard profile. */
export const PROFILE_STORAGE_KEY =
    "slow-trading:backtest-precision:leaderboard-profile:v1";

export function readStoredProfileName(): string {
    try {
        return localStorage.getItem(PROFILE_STORAGE_KEY) ?? "";
    } catch {
        return "";
    }
}
