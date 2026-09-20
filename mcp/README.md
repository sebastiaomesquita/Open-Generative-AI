# Generation MCP server (local, stdio)

Lets Claude Code generate images and videos from the terminal, on this Mac,
saving the result straight into the project you are working in.

Three engines behind one server:

| | `local_generate` | `openrouter_generate_image` | `higgsfield_generate` |
|---|---|---|---|
| Cost | **free** | ~US$ 0.01 to 0.15 per image | per job, usually more |
| Runs on | this Mac's GPU | OpenRouter | Higgsfield |
| Network | none, works offline | required | required |
| Media | images only | images only | **images and video** |
| Quality | draft to good | very good | state of the art |
| Speed on an M1 Pro 16 GB | 4 to 7 minutes | seconds | seconds to minutes |
| Cost control | nothing to control | daily budget | per-job ceiling |

Rule of thumb: draft locally for free, finish on OpenRouter, and go to
Higgsfield only for video, which is the one thing the other two cannot do.

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

## Local engine (free)

`local_generate` runs stable-diffusion.cpp against weights on disk, using the
Mac's GPU through Metal. No account, no key, no balance, no network. The
result returns `cost_usd: 0` and a `metal` flag saying whether the GPU was
actually used.

`local_status` lists which models are downloaded and which are missing. The
weights and the engine are the ones the desktop app installed, so there is one
copy on disk; download new ones in the app under Settings > Local Models.

What local cannot do: video. stable-diffusion.cpp is image-only, and the app's
video engine needs CUDA, which no Mac has.

Local-only extras that the cloud models do not accept: `negative_prompt`, an
explicit `steps` count and `cfg_scale`.

Measured on an M1 Pro with 16 GB, same prompt and seed, Metal confirmed:

| Model | Output | Time |
|---|---|---|
| Dreamshaper 8 (SD 1.5) | 640x512 | 228 s |
| Z-Image Turbo | 1344x1024 | 400 s |

Z-Image Turbo is worth the extra wait: far more photoreal, and only 8 sampling
steps. It renders at a 1024 base, which is where the time goes. Dreamshaper is
the one to iterate with.

Output filenames carry the model id and the seed, so running one prompt on two
models leaves you both files to compare instead of one overwriting the other.

## OpenRouter engine (cheap)

One key covers both halves of the workflow: the desktop app's "Enhance prompt"
button rewrites the prompt through OpenRouter, and `openrouter_generate_image`
renders it. Same account, same bill.

```bash
node mcp/server.js --save-openrouter-key sk-or-v1-...
```

Keys come from <https://openrouter.ai/keys> and go into the macOS keychain, not
into a config file.

`openrouter_list_image_models` lists what is available, cheapest first. As of
today that spans about US$ 0.01 per image for GPT-5 Image Mini up to US$ 0.15
for Nano Banana Pro, with Nano Banana around US$ 0.04 as the default.

Prices are quoted per output token, not per image, and an image runs about
1100 to 1300 tokens depending on size. So the list shows a range, and every
generation returns the real figure OpenRouter charged.

### Daily budget

OpenRouter only reveals a cost after the work is done, so a per-call ceiling
like Higgsfield's is impossible. Instead every call is written to a ledger and
checked against a rolling daily budget, **US$ 2.00** by default.

- `OPENROUTER_DAILY_USD` changes it. `OPENROUTER_DAILY_USD=0` freezes spending
  entirely while leaving the local engine usable.
- Once the day's budget is gone, the next call is refused **before** the
  request is sent.
- `openrouter_spend` reports today's total, the split per model, and the last
  week.
- The ledger lives at `~/.higgsfield-mcp/spend.json`, mode 0600, keeping a
  month of history.

It counts what this server spends, not what the desktop app or any other tool
spends on the same key. Treat it as a guard rail, not as accounting.

## Transport, and what that rules out

This is a **stdio** server: Claude Code starts it as a child process. Claude
Chat and Cowork cannot use it — a custom connector there is dialled from
Anthropic's cloud, not from your machine, so it can never reach a process on
this Mac. Serving those needs the same code behind a public HTTPS endpoint.

## Setup

The local engine needs no setup beyond having the desktop app install the
engine and at least one model. Check with `node mcp/server.js --status`.

For the cloud engine only:

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

- **`local_status`** — which local models are ready. Free.
- **`local_generate`** — generate on this Mac. **Free.**
- **`openrouter_list_image_models`** — models and prices. Free.
- **`openrouter_generate_image`** — generate through OpenRouter. **Costs cents.**
- **`openrouter_spend`** — today's spend against the budget. Free.
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
| `HF_LOCAL_AI_DIR` | the desktop app's folder | where the local engine and weights live |
| `OPENROUTER_API_KEY` | keychain | overrides the stored OpenRouter key |
| `OPENROUTER_DAILY_USD` | `2.00` | daily budget; `0` freezes OpenRouter |
| `HF_SPEND_LEDGER` | `~/.higgsfield-mcp/spend.json` | where the ledger is written |
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
