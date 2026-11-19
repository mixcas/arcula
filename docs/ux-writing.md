# UX writing

Arcula's interface is written, not filled in. This page is how the writing
works: the voice, where its humour is allowed to land, and the mechanics that
keep it consistent. It is the standard a reviewer applies to a diff and the
instruction an agent loads before writing a string. It covers every word a
person reads — the SPA, the mails, the public catalogue's chrome, and the
landing page.

The product's vocabulary is in [GLOSSARY.md](../GLOSSARY.md). This page is about
how those words are used in a sentence. Where the two disagree about a _name_,
the glossary wins.

## The one idea

"10–20% playful" is not a percentage of each string. A string either has a turn
in it or it does not; there is no fifteen-percent-funny sentence. So the budget
is spent on **surfaces**: roughly one in six of the moments a person reads is
allowed to carry a personality, and the rest are plain.

That ratio is the whole guideline. Everything below is how to spend the sixth
well, and how to keep the other five honest.

## The voice

Three principles. A draft that fails one of them is rewritten, not decorated.

### Precise

Say the exact thing. Name the mechanism when the mechanism is what the person
needs to know.

- Yes: "The record is kept — this is a soft delete, so you can restore it from
  the catalogue's Deleted view."
- No: "This will be permanently removed."

Precision is also why the product is allowed to be dry: an exact sentence has
nothing to apologise for.

### Dry

The delivery never strains. A joke that needs a setup is not one of ours.

- Yes: "No catalogues yet. Start with one — the rest tend to follow."
- No: "No catalogues yet! Let's get this show on the road 🎨"

Dry does not mean cold, and it does not mean humourless. It means the line is
worth reading twice, not laughing at once.

### Warm

Never cold to a person, especially when something has gone wrong. Warm is the
principle that keeps _dry_ from becoming _curt_.

- Yes: "Could not restore the artwork. Nothing was restored — try again."
- No: "Restore failed."

Warmth is carried by naming the consequence and the next step, not by adding
"please" and an exclamation mark.

## Where the playfulness lives

**Personality surfaces** — the sixth:

- first-use empty states
- success toasts
- the moment after a destructive action was undone or completed
- the public catalogue's own chrome: empty, private, locked, not found
- onboarding and the invitation landing
- the landing page, which is the exemplar

**Plain surfaces** — the other five:

- field labels and helper text
- buttons (a button may be warm; it may not be clever)
- inline validation
- any sentence that carries a recovery path
- settings, confirmations, and everything in the no-fly list

A personality surface may be plain. A plain surface may never be playful. When
the sixth has been spent nearby, the right move is to stop, not to find another
string to improve.

## The tone ladder

The voice is constant; the tone moves with the situation. Four rungs, and a
draft should be recognisably on one of them.

| Situation | Tone                          | Shape                                    | Example                                                               |
| --------- | ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| It worked | Quiet pleasure, never a party | Past tense, specific                     | "Saved" · "Restored"                                                  |
| Routine   | Efficient and plain           | Verb first, no ceremony                  | "Add artwork"                                                         |
| Caution   | Serious, transparent, no spin | Consequence, then the choice             | "You lose access immediately. Works you saved stay in the catalogue." |
| Failure   | Warm, concrete, forward       | What failed → what survived → what to do | "Nothing was deleted. Check your connection and try again."           |

The ladder is the reason "Saved!" is wrong even though saving is good news:
celebration louder than the event reads as sarcasm.

## The no-fly list

Never playful:

1. Destructive confirmations and their consequences — delete, revoke, remove,
   leave, transfer.
2. The login screen, the reset request and the reset form. The reset answer must
   read the same whether or not an account exists; a joke there leaks
   information.
3. Errors that carry a recovery path.
4. The Connection consent screen. Someone is deciding what an agent may do with
   their catalogues.
5. Legal, privacy, and anything about data ownership or export.
6. Accessibility text: alt text, `aria-label`s, screen-reader-only copy.
7. Anything read by someone locked out, losing data, or being told no.

And the rule that covers all seven: **the wit never costs a word of the
instruction.** If a joke and a fact are competing for the same clause, the fact
has already won.

## Mechanics

These are not style preferences; they are the things a reader notices when they
are wrong.

**Sentence case everywhere.** "Save changes", "Catalogue settings", "Delete
artwork?". Title Case is not used in the interface, in mail, or on the landing
page.

**No exclamation marks.** Zero, in product copy. Enthusiasm is carried by the
verb, and a sentence that needs an exclamation mark needs a rewrite.

**The ellipsis is `…`**, one glyph, and it belongs only to work in progress:
"Deleting…", "Searching…". Never in a static label, never as three periods.

**Curly punctuation in copy**: `’`, `“”`. Straight quotes belong to code. A
person's catalogue name or artwork title is quoted curly when it has to be
quoted at all — and it usually does not.

**Numerals are digits**, including one: "1 artwork", not "one artwork". A small
number inside a sentence ("one of six") follows the sentence, not the count.

**The em dash is fine in body copy** and never in a button. It is the product's
comma of emphasis; do not reach for it twice in a paragraph.

**No emoji** in product copy, including toasts and mail.

**US spelling**, with one declared exception: **Catalogue**. It is a domain
noun, not a British habit — the art-world word, and the product's own — so
`catalogue`, `catalogues` and `cataloguing` are correct here and `catalog` is
not. Everything else is American: `favorite`, `color`, `center`, `organize`,
`canceled`, `gray`, `license`, `traveled`.

**Capitalisation never marks vocabulary.** Only proper names take a capital:
**Arcula**, and the three Kind names **Portfolio**, **Collection** and
**Inventory**. Everything else is lowercase in running prose — catalogue,
artwork, connection, collaborator, invitation — and a heading gets a capital on
its first word and nowhere else.

**"You" for the person. "We" only where a human acts** — an invitation, a
transfer notice, a reply to a mail. Errors never say "we": "we couldn't" is a
company apologising, and a machine stating a fact is kinder.

## Patterns

### A button

Verb, then object, in sentence case: "Add artwork", "Save changes", "Send
invitation". Two to four words. Never "Submit", "OK", or "Click here" — the
label says what happens.

The one exception is a pending state, which may become the work itself:
"Deleting…" replaces "Delete" while the request is in flight.

### An empty state

Three parts, and only the first is compulsory:

1. The state, plainly: "No catalogues yet."
2. One true sentence — what this place is for, or what happens next.
3. One call to action.

```text
No catalogues yet
A catalogue is where your artworks live. Start with one — the rest tend to follow.
[Create your first catalogue]
```

A one-line empty state ("No documents yet.") is complete. Do not pad it to
match a richer one.

### A toast

Past tense, specific, and silent about what the person already knows: "Saved",
"Restored", "Catalogue deleted". A toast that explains itself is usually
covering for an unclear action; say the consequence instead: "The artwork was
removed. You can restore it from the Deleted view."

### An inline validation message

The field, then the requirement: "Password must be at least 8 characters".
Never "Invalid input", and never the person's fault.

### A system error

What failed, what survived, what to do — in that order, in the fewest words
that survive the mutation.

```text
Could not save the settings. Nothing was changed — try again.
```

"Nothing was changed" is not padding. It is the sentence that tells a person
whether they need to re-enter anything.

### A destructive confirmation

Name the thing, state the consequence, name the reversal if there is one, and
let the button repeat the verb. No jokes, no softening, and never "Are you
sure?"

```text
Delete artwork?
Membrana will be removed from this catalogue and from the public page.
The record is kept — this is a soft delete, so you can restore it from the
catalogue's Deleted view.
[Delete] [Cancel]
```

### An email

The same voice, one degree warmer, because a person wrote to you: one identity,
one call to action, and a line saying why the message arrived. The shape is in
[mail.md](mail.md). The reset mail is the exception to the warmth — it states
what to do, and what happens if you did not ask.

### The public catalogue's chrome

The public page belongs to the collector: their name, their description, their
works. Arcula's own copy there is limited to the states it owns — the lock
screen, a private or unavailable catalogue, the empty catalogue, a failed load —
and those may carry the voice. "Powered by Arcula" stays plain. The skin itself
stays silent.

### The landing page

It is the exemplar, not a target: it already writes this voice ("Art is not
tidy data.", "A few honest answers."). When the app and the landing page
disagree, the landing page is right. Its one buried meme reference is allowed
because it is buried, and never because it carries meaning.

## Vocabulary

Names come from [GLOSSARY.md](../GLOSSARY.md), including its _Avoid_ lists. A
few that a draft reaches for by instinct:

| Write                      | Not                            | Why                                                       |
| -------------------------- | ------------------------------ | --------------------------------------------------------- |
| Log in / log out           | Login (as a verb), logout      | "Log in" is the verb; "login" is the noun                 |
| Account                    | Profile, user                  | The glossary's name for the person's identity             |
| Artwork                    | Work, piece, item              | One name for the record on every surface, agents included |
| Collaborator               | Member, editor, guest          | Membership is the write verdict, and it has one name      |
| Reset request / reset link | Forgot password, reset email   | The same sentence whether or not an account exists        |
| Invitation                 | Invite (as a noun), share link | The object is an invitation; the button sends one         |
| Delete                     | Remove, when it is permanent   | Say what happened                                         |
| Try again                  | Please try again, retry        | Warmth is not a politeness word                           |

## The example bank

Real strings, before and after. These are the standard, not suggestions.

| Before                                                                                   | After                                                                                                    | Why                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------- |
| "Failed to fetch catalogues"                                                             | "Could not load your catalogues."                                                                        | The voice's verb        |
| "User not authenticated"                                                                 | "Your session has ended. Log in again."                                                                  | Never "user"; a way out |
| "Failed to save settings. Please try again."                                             | "Could not save the settings. Try again."                                                                | One verb, one sentence  |
| "No images yet. The first image is the one used as the thumbnail everywhere in the app." | "No images yet. The first one becomes the thumbnail."                                                    | Fewer words, same fact  |
| "Loading catalogue..."                                                                   | "Loading catalogue…"                                                                                     | One glyph               |
| "Add Artwork"                                                                            | "Add artwork"                                                                                            | Sentence case           |
| "No catalogues yet / … Start one, then add your first work."                             | "No catalogues yet / A catalogue is where your artworks live. Start with one — the rest tend to follow." | The sixth, spent well   |
| "Delete artwork? … this is a soft delete, so you can restore it"                         | unchanged                                                                                                | Already the standard    |

## Reviewing a draft

Read the string, then ask:

1. **Which surface is this?** If it is plain, is the extra word earning its
   place? If it is a personality surface, has the sixth already been spent
   nearby?
2. **Does it survive being read two hundred times?** Product copy is not read
   once. A line that only works on first reading is a line that will annoy.
3. **Is the instruction intact?** Remove the joke; if a fact disappeared with
   it, the joke was load-bearing.
4. **Would this fail if Mantine changed, or only if we did?** The same question
   [testing.md](testing.md) asks of a test. A string that only breaks when the
   library changes was never ours to write.
5. **Does it contradict the glossary or another screen?** Log-in vocabulary,
   "could not" against "failed", and Title Case are the three that keep coming
   back.

## Scope

Not covered: the words a person types (catalogue names, descriptions and
artwork titles are theirs), the API's internal error contract (the server keeps
its precise messages; the web app decides what reaches a person), and code
comments, which follow the spelling rule only when you are already editing the
line.
