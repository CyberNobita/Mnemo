# SearXNG for OpenMuse

[SearXNG](https://docs.searxng.org/) is a free, self-hosted metasearch engine. It sends your
query to public engines (Google, Bing, Brave, DuckDuckGo, Wikipedia and others) without cookies
or tracking, and returns JSON to OpenMuse. No API key is needed.

## Run it (Docker Desktop)

1. Copy `settings.yml` to a folder such as `D:\searxng`.
2. Replace `secret_key` with a random value, for example from `openssl rand -hex 32`.
3. Start the container. It listens on this computer only and restarts with Docker:
   ```
   docker run -d --name searxng --restart unless-stopped -p 127.0.0.1:8888:8080 -v "D:/searxng:/etc/searxng" searxng/searxng:latest
   ```
4. Check that it works: open http://127.0.0.1:8888/search?q=test&format=json
5. Add `SEARXNG_URL=http://127.0.0.1:8888` to OpenMuse's `.env` and restart the API.

The `settings.yml` here turns on the JSON format and turns off the rate limiter. The limiter is
off because only this computer can reach the instance. Do not publish port 8888 to your network.

## Notes

- Some engines sometimes answer with a CAPTCHA (DuckDuckGo often does). SearXNG skips them and
  uses the others.
- Routing SearXNG through Tor also hides your IP from the engines. It is much slower, and many
  engines block Tor exit nodes.
- To update: `docker pull searxng/searxng:latest`, then `docker rm -f searxng` and run step 3 again.
