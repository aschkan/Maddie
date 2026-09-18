# Test fixtures

`47022NED-*.json` — three REAL recorded replies from CBS's open OData API for
table 47022NED (recorded offences by neighbourhood by month): the table's column
metadata, its offence code list, and twelve months of one Amsterdam
neighbourhood. They are committed so `test/nl-crime.test.ts` runs offline like
everything else here, and they are worth keeping exactly as recorded — the
dataset carries both of the things that have actually broken this integration:
the `Misdrijven, totaal` roll-up row and seven `null` cells that mean "withheld"
rather than zero. Regenerating them by hand, or tidying the nulls away, removes
the only evidence those two code paths are tested against something real. This
is public open data about no individual.

`localhost-cert.pem` / `localhost-key.pem` — a self-signed certificate for
`localhost`, valid for a century, used by `test/proxy-chain.test.ts` to stand up
a throwaway HTTPS server on an ephemeral port.

**This key is public and belongs in the repository.** It secures nothing: it is
generated for `CN=localhost`, it is committed here for everyone to read, and the
only thing that ever presents it is a server the test starts and stops inside a
single `node --test` run. Do not reuse it for anything, and do not treat a
scanner flagging it as a leak — there is nothing behind it.
