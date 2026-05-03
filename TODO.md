# TODO

## Domains

- [ ] Register a domain for the Troop 731 site (currently at `troop731.fly.dev`)
- [ ] Register a domain for Kathryn's site

## Notes

When the troop domain is registered:
1. Add it as a custom domain in Fly.io: `fly certs add <domain> -a troop731`
2. Update DNS A/AAAA records to point to Fly's edge IPs
3. Wait for cert provisioning (LetsEncrypt, ~minutes)
