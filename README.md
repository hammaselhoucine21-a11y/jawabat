# Jawabat

A one-page form for answering 20 questions by voice note, screenshot or text,
one question per screen. Static files only (GitHub Pages); answers go to a
Supabase table and a private storage bucket.

- `config.js` holds the Supabase project URL and the publishable key. Empty values = demo mode (nothing leaves the device).
- The answer link needs `?k=<code>`. The database only accepts rows and files that carry the right code, and nobody can read them back with the public key.
- `?demo=1` forces demo mode; `?k=<code>&selftest=1` checks the connection and the policies.
- Recordings and pictures are kept in the browser (IndexedDB) until they are sent, and are retried after a lost connection.

Design notes: `DESIGN.md`.
