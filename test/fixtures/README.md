# Test fixtures

`localhost-cert.pem` / `localhost-key.pem` — a self-signed certificate for
`localhost`, valid for a century, used by `test/proxy-chain.test.ts` to stand up
a throwaway HTTPS server on an ephemeral port.

**This key is public and belongs in the repository.** It secures nothing: it is
generated for `CN=localhost`, it is committed here for everyone to read, and the
only thing that ever presents it is a server the test starts and stops inside a
single `node --test` run. Do not reuse it for anything, and do not treat a
scanner flagging it as a leak — there is nothing behind it.
