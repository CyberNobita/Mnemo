// Unit/API fixtures must never emit production SDK telemetry.
// Telemetry tests exercise enabled behavior in isolated child processes.
process.env.DO_NOT_TRACK = "1";
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
// A developer's .env must not change which providers tests exercise. Empty values are kept
// because .env loading never overrides a variable that is already set.
process.env.SEARXNG_URL = "";
process.env.BRAVE_SEARCH_API_KEY = "";
process.env.LOCAL_CHATS = "";
