# Runtime Prompts (for real providers)

Not used by the stub provider. When a real provider (Claude, Bob, Gemini, Groq, ...) is implemented, it sends these prompts for the matching stage. Rules:

- Front matter lists every variable; a missing variable is an error.
- Reporter text appears only inside `{{untrusted_report}}`, wrapped as `security.md` T2 describes.
- The provider appends the stage's JSON schema and "Reply with one JSON object and nothing else."
- File outputs are returned as proposals (path and full content), never written by the provider (`ai-providers.md`).
