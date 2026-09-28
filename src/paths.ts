import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = homedir();
export const CLAUDE_DIR = join(HOME, ".claude");
export const CODEX_DIR = join(HOME, ".codex");
export const STATE_FILE = join(HOME, ".cache", "agtc-vscode", "state.json");
/** Shared with the agtc hub, so a spec written for one is found by the other. */
export const PROMPTS_DIR = join(HOME, ".cache", "agtc", "prompts");
export const SPECS_DIR = join(HOME, ".cache", "agtc", "specs");
