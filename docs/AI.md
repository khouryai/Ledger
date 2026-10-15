# The on-device AI

Ledger can use an open-source language model that runs **on the laptop itself**, in
the browser, on the graphics chip, through [WebLLM](https://github.com/mlc-ai/web-llm).
Nothing it reads is sent anywhere. It is off by default.

## What it is used for, and what it is not

The model is used for language only:

| Job | Where | Without the model |
| --- | --- | --- |
| Find the actions in an email, a thread or meeting notes | Capture, meeting notes | The rules in `engine/asks.ts` |
| Write a chaser in the right tone for the history | The chase dialog | The templates in Settings |
| Judge whether a reply delivers, and pick up a new date | An item's "Did their reply close it?" | The rules in `engine/reply.ts` |
| Write the week up as a paragraph | Weekly review → The week | The summary as lines |
| Brief you before a call | People | The facts as lines |

Every **decision** (when to chase, what is at risk, what looks dead, the order of the
day) comes from your own history by counting, in `engine/decide.ts` and
`engine/stats.ts`. No model is involved, and every decision shows its reason.

## How its answers are checked

The model's answer never goes straight into the ledger:

- **Dates.** The model returns the words ("next Tuesday"); the date is worked out by
  the same parser the quick-add line uses. For a reply, the date has to appear in the
  reply itself, not only in the model's answer.
- **People.** A name is matched exactly to your people list. One it does not know is
  offered as a new person, never mapped to the nearest one. You are never taken for
  the other person.
- **Quotes.** Each action carries the sentence it came from. If that sentence is not in
  the text, the suggestion says so ("the model's words; not found in the text").
- **Format.** The model is constrained to a JSON schema; an answer that still will not
  parse is reported, and the rules remain one click away.
- **Nothing is written until you accept it.** Suggestions are ticked and added by hand.
  Items added from a model suggestion record that in their history.

## The models offered

All are prebuilt WebLLM models, quantised to 4 bits. The memory figure is WebLLM's
estimate of the graphics memory needed.

| Model | Maker | Graphics memory | Notes |
| --- | --- | --- | --- |
| Phi-4 mini (default) | Microsoft | about 3.4 GB | Best quality of the four. MIT licence. |
| Llama 3.2 3B | Meta | about 2.2 GB | Faster, slightly weaker. |
| Qwen 2.5 3B | Alibaba | about 2.5 GB | Strong at structured answers. Some companies restrict Chinese-made models; check your policy. |
| Llama 3.2 1B | Meta | about 0.9 GB | For laptops with little graphics memory. Noticeably weaker. |

The model's context window is 4,096 tokens, so long text is read in pieces of about
4,500 characters and the answers combined.

## Where the model comes from and where it is kept

The first **Download and load** fetches the model's weights from `huggingface.co` and
its compiled engine from `raw.githubusercontent.com`. They are kept in the browser's
own storage (the Cache API for the served version, IndexedDB for the single file
opened from disk) and loaded from there afterwards with no network. **Settings → Remove
the download** deletes them.

## Testing

The browser tests run the whole path (prompt, answer, checking, accepting) with a
stand-in model (`src/ai/fake.ts`) that answers in the model's format using the rules,
because the test machines have no graphics chip. The stand-in is switched on only by a
test setting a flag before the page loads; it is never offered to a user. The real
WebLLM engine is exercised by hand: **Settings → On-device AI → Try it on a sample**.
