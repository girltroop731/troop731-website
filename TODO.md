# TODO

## Domains

- [x] Register `girltroop731.org` (Namecheap, May 2026)
- [ ] Point `girltroop731.org` to Fly app `troop731`
  - `fly ips list -a troop731` (allocate shared v4 if needed)
  - Add A/AAAA records at Namecheap
  - `fly certs add girltroop731.org -a troop731`
  - `fly certs add www.girltroop731.org -a troop731`
- [ ] (Later) Register `clemmonsscouts.org` for landing-page hub
  - Static page already drafted in a separate workspace

## Notes

- Troop site currently lives at `https://troop731.fly.dev`
- Boys troop has no web presence yet — hub page will skip them until they do
