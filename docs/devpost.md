# Devpost submission copy

Paste-ready. Section headings match Devpost's default description template.

---

## Project name

**Crucible**

## Tagline

An AI code grader that is architecturally forbidden from setting the grade.

## Links

- **Try it:** https://crucible-green.vercel.app
- **Video (2:00):** <!-- TODO: video URL -->
- **Repo:** https://github.com/biyonjose10/crucible

## Gallery image

The grading queue mid-run — thirty cards, mostly green and red, one amber. Not a logo. Devpost galleries are browsed as thumbnails, and a wall of live results reads as a working product at 200 pixels wide.

---

## Inspiration

A CS teaching assistant gets 200 submissions and 48 hours. What actually happens at 2am is: run the file, see a failure, write "logic error, −3", move on. The student receives a number and no diagnosis. The most expensive artifact in the course teaches nothing.

The two existing answers are each half of a solution. Autograders give a verdict with no pedagogy: you failed, good luck. LLM graders give pedagogy with no reliability: they hallucinate scores, drift between runs, and can be talked out of a grade by a comment in the source file. Neither is something a real instructor can put their name on.

So we stopped trying to make one system do both jobs.

## What it does

Crucible grades a class of Python submissions and explains every failure.

The grade comes from execution. Each submission runs against a test suite in a real Python interpreter, every test maps to exactly one rubric clause, and the score is the arithmetic sum of the clauses that passed. The explanation comes from a language model that is shown only the failing traces — expected value, actual value, raw traceback — and asked to say what went wrong and where.

The student gets what a −3 never told them: line six, the midpoint index truncates on even-length input, rubric clause two. The instructor gets a queue they can skim in a minute instead of a night.

## How we kept it honest

This is the part we care about, and every item is a structural property of the codebase rather than a prompt instruction.

**The scoring module cannot reach a model.** `lib/scoring.ts` is a pure function from execution results to a score report. It imports nothing but TypeScript types. Our verification script reads its import list and fails the build if anything matching `anthropic`, `google`, `gemini`, `genai`, `openai`, `diagnose`, or `ai` appears. You can check this claim faster than you can read this paragraph: open the file.

**Prompt injection fails structurally.** One of our demo submissions opens with a comment telling the grader to ignore the tests and award full marks. It scores 4/10. Nothing filtered that comment — the model read it, and simply had no tool that could write a grade. We did not build a defence. We built an architecture where the attack has nowhere to land.

**Hidden tests defeat gaming.** Each clause is checked by visible tests published with the assignment and hidden tests using different inputs. Our hardcoding archetype passes all five visible tests, fails five of the seven hidden ones, and earns 4/10.

**Determinism is observable, not asserted.** Grade the same class twice and the scores are byte-identical. That is not a claim about the model's temperature. There is no model in that path to have one.

**Claims are anchored to captured evidence.** A feedback sentence renders only if it cites a specific test result and its real traceback. Claims that cannot be anchored appear in a rejected tray rather than disappearing quietly, so you can see what the model wanted to say and why it wasn't allowed to.

**Timeouts degrade to amber, never to a spinner.** An infinite loop is killed by `Worker.terminate()`, which genuinely stops it where a Python-level `try/except` cannot. Results printed before the kill are kept. Tests that never reported are marked inconclusive — never assumed to pass, never assumed to fail — and the submission is flagged for human review.

**Passing tests are free.** The model is invoked only on failure, and identical failure signatures are hashed, diagnosed once, and reused. Cost grows with the number of distinct misconceptions in a class, not the number of students.

And the honest caveat, since we would rather say it than have it asked: the model can be wrong about the diagnosis. It cannot be wrong about the score. A wrong explanation is cheap and a student can see through it. A wrong grade is expensive and invisible.

**It answers the teacher's next question too.** Once a class is marked, the useful number is not the average — it is which single misconception is worth a lesson. Crucible counts the same clause results across the cohort and says so plainly: eleven of thirty missed the even-length midpoint.

**And it proves its own claim on screen.** A panel on the landing page reads the import list of `lib/scoring.ts` out of the file at build time and displays it. It says `./types`. Wiring a model into the grading path would change what the visitor is reading.

**You do not have to take the demo's word for any of it.** There is a box on the landing page. Paste your own Python, press the button, and it runs through the same sandbox, the same tests and the same scoring function as the seeded class.

## How we built it

Next.js 16 App Router with React 19, TypeScript, and Tailwind 4 — a single deployment, no separate backend service.

Execution is **Pyodide**: real CPython 3.14 compiled to WebAssembly, running in a Web Worker and self-hosted from `/public/pyodide`. A generated Python harness runs each submission and emits one JSON line per test result, flushed immediately so that results produced before a kill survive it. The parser accepts a line only if it carries an internal marker *and* names a test id the suite actually declared, so a student printing to stdout cannot forge a passing result. The module cache is cleared between submissions, because a stale import would silently grade the previous student's code.

Diagnosis uses the Google Gemini API. The prompt receives the rubric clause, the failing test, and the raw traceback. It does not receive the score, because there is no code path that would give it one.

Eight archetypes carry the whole demo: correct, off-by-one, wrong return type, infinite loop, syntax error, prompt injection, hardcoded answers, and empty-input crash. Their expected scores are asserted in the build gate, so any change to the rubric or the harness that moves a number breaks the build instead of quietly shipping.

## Challenges we ran into

**Our sandbox disappeared mid-build.** The plan was the Piston public execution API — free, no key, no Docker on Windows. It started returning HTTP 401: the public instance went whitelist-only in February. Losing your execution layer when the entire thesis is "we really run the code" is not a small problem.

Moving to self-hosted Pyodide turned out to be a better project. There is now no third-party runtime in the stack at all — no API key, no rate limit, no queue, and no way for someone else's outage to break the demo while a judge is watching. It also removed a whole class of latency: execution happens in the visitor's browser, so grading thirty submissions does not mean thirty round trips.

**Killing an infinite loop is harder than it looks.** You cannot stop runaway Python from inside the same interpreter; a timeout implemented in Python never gets scheduled. `Worker.terminate()` genuinely kills it, but everything printed before the kill has to be preserved, which is why the harness flushes each result line as it is produced rather than reporting at the end. The build gate reproduces the same mechanism in Node by running each archetype in its own child process and killing it from the parent.

**Deciding what "inconclusive" means.** A test that never reported is not a failure and not a pass. Treating it as either would put a wrong number in a gradebook. It became its own status, propagating up to an amber card that asks for a human.

## What we learned

The interesting design work was in what we refused to let the model do. It is easy to hand an LLM a tool and let it write to the score — and every failure mode after that point is unfixable by prompting, because you have already given away the property you needed.

We also learned that a trust claim is worth very little unless it is cheap to check. "Our AI doesn't set the grade" is a sentence anyone can write. `lib/scoring.ts` having no import path to a model is something a skeptical person verifies in two seconds, and that difference is the entire project.

## What's next

- Instructor-authored assignments: paste a spec and a test file, get the rubric-to-test mapping.
- Persistence and a real gradebook export.
- Cross-class misconception clustering. Failure signatures already collapse identical mistakes, so aggregating them across a cohort tells an instructor which concept to reteach on Monday — the thing an autograder has never been able to say.

## Built with

`next.js` · `react` · `typescript` · `tailwindcss` · `pyodide` · `webassembly` · `web-workers` · `python` · `google-gemini` · `motion` · `vercel`

Full list for the "Built With" field:

```
next.js, react, typescript, tailwindcss, pyodide, webassembly, web-workers,
python, google-gemini, node.js, vercel
```

---

## Categories to select

- **Machine Learning/AI** — required; AI is the diagnosis layer and the constraint on it is the thesis.
- **Design** — the queue, the amber inconclusive state, and the evidence-anchored feedback cards are the entry's UX argument.
- **Beginner Friendly** — eligible, and there is no reason to leave a category unchecked.

## Pre-submission checklist

- [ ] Repo is public, and no `.env.local` or API key is committed
- [ ] Live URL loads with no login and no key, in a browser that has never seen it
- [ ] `npx tsx scripts/verify.ts` passes on a clean clone
- [ ] Video is at or under 2:00 and is publicly viewable without sign-in
- [ ] Gallery image is the queue mid-run, not a logo
- [ ] Tested on a phone and in a second browser
- [ ] Submitted with hours to spare — Devpost queues near the deadline
