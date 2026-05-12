const fallbackUtf8Locale = "en_US.UTF-8";

type PtyEnvSource = Record<string, string | undefined>;

export function createPtyEnv(sourceEnv: PtyEnvSource = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  ensureUtf8Locale(env);
  return env;
}

function ensureUtf8Locale(env: Record<string, string>): void {
  if (!isUtf8Locale(env.LANG)) {
    env.LANG = fallbackUtf8Locale;
  }
  if (!isUtf8Locale(env.LC_CTYPE)) {
    env.LC_CTYPE = env.LANG;
  }
  if (env.LC_ALL && !isUtf8Locale(env.LC_ALL)) {
    env.LC_ALL = env.LANG;
  }
}

function isUtf8Locale(value: string | undefined): boolean {
  return Boolean(value && /utf-?8/i.test(value));
}
