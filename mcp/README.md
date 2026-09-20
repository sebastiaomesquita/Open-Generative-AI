# Higgsfield MCP server (local, stdio)

Lets Claude Code generate Higgsfield images and videos from the terminal, on
this Mac, saving the result straight into the project you are working in.

## Why this exists next to the official MCP

Higgsfield publishes a remote MCP at `https://mcp.higgsfield.ai/mcp`. It is
excellent and needs no setup, but it runs in Higgsfield's cloud and bills the
**plan credits** of a higgsfield.ai subscription. This server is different on
four points that only matter locally:

| | Official remote MCP | This server |
|---|---|---|
| Billing | higgsfield.ai plan credits | pay-per-use USD balance from `console.higgsfield.ai` |
| Where the file lands | a CDN link that expires in ~7 days | written to disk, path returned |
| Cost control | none exposed | every job priced first, refused above a ceiling |
| Model list | Higgsfield's own | the same catalogue the desktop app uses |

Use whichever fits. They can coexist.

## Transport, and what that rules out

This is a **stdio** server: Claude Code starts it as a child process. Claude
Chat and Cowork cannot use it — a custom connector there is dialled from
Anthropic's cloud, not from your machine, so it can never reach a process on
this Mac. Serving those needs the same code behind a public HTTPS endpoint.

## Setup

1. Create an API credential at <https://console.higgsfield.ai> (format
   `KEY_ID:KEY_SECRET`, the secret is shown once) and top the balance up.
2. Store it in the macOS keychain, so it never sits in a config file:

   ```bash
   node mcp/server.js --save-credential KEY_ID:KEY_SECRET
   ```

3. Register the server with Claude Code:

   ```bash
   claude mcp add higgsfield --scope user -- node /absolute/path/to/mcp/server.js
   ```

Check it any time with `node mcp/server.js --status`.

## Tools

- **`higgsfield_list_models`** — the catalogue, with allowed aspect ratios,
  durations and which models need a reference image. Free.
- **`higgsfield_estimate`** — what a generation would cost, in USD and credits,
  without running it. Free.
- **`higgsfield_generate`** — generates and saves to disk. **Spends money.**
- **`higgsfield_upload_image`** — local file to a public URL, for
  image-to-video. Free.

## Spending

`higgsfield_generate` prices every job before submitting it and refuses
anything above **US$ 0.50** by default. The refusal tells the caller the exact
`approve_usd` value that would let it through, so the agent has to state a
budget rather than discover the bill afterwards.

- `HF_MAX_USD` raises or lowers the ceiling. `HF_MAX_USD=0` prices everything
  and runs nothing, which is a useful dry-run mode for a whole session.
- If Higgsfield does not return a price, the job is refused rather than
  assumed cheap.
- Higgsfield only charges completed jobs; `failed` and `nsfw` are refunded.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `HF_CREDENTIALS` | keychain | `KEY_ID:KEY_SECRET`, overrides the keychain |
| `HF_MAX_USD` | `0.50` | spend ceiling per generation |
| `HF_OUTPUT_DIR` | `~/Downloads/higgsfield` | where results are saved |
| `HF_BASE_URL` | `https://api.higgsfield.ai` | API host, for testing |

## Notes that cost time to rediscover

- Endpoint paths are the docs' "Endpoint ID": no leading slash, no host.
- Soul takes `aspect_ratio` + `resolution`. The v1 SDK's
  `width_and_height`/`quality` are wrong and return 422.
- Image-to-video takes `image_url` as a plain string and ignores
  `aspect_ratio`: the source frame decides it.
- Kling, Seedance and Minimax reject `seed`. Soul and Wan accept it.
- `negative_prompt` does not exist on any model.
- Every `*_url` must be public HTTPS. Data URIs are not accepted.
- The real rate limit is concurrency, not requests per minute, and it surfaces
  as HTTP 400.

## Tests

```bash
node --test tests/higgsfieldMcp.test.js
```

Covers the spend guard, the tool schemas, and a full submit / poll / download
cycle against a fake API on localhost. No credential and no spending.
