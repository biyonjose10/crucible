# ===== FIELD 1: "About the project" — select all below the line and paste =====

## Inspiration

A CS teaching assistant gets 200 submissions and 48 hours. What actually happens at 2am is: run the file, see a failure, write "logic error, −3", move on. The student receives a number and no diagnosis. The most expensive artifact in the course teaches nothing.

The two existing answers are each half of a solution. Autograders give a verdict with no pedagogy: you failed, good luck. LLM graders give pedagogy with no reliability — they hallucinate scores, drift between runs, and can be talked out of a grade by a comment in the source file. Neither is something a real instructor can put their name on.

So we stopped trying to make one system do both jobs.

## What it does

Crucible grades a class of Python submissions and explains every failure.

**The grade comes from execution.** Each submission runs against a test suite in a real Python interpreter, every test maps to exactly one rubric clause, and the score is the arithmetic sum of the clauses that passed. **The explanation comes from a language model** that is shown only the failing traces — expected value, actual value, raw traceback — and asked to say what went wrong and where.

The student gets what a −3 never told them: line six, the midpoint index truncates on even-length input, rubric clause two. The instructor gets a queue they can skim in a minute instead of a night.

And you do not have to grade our exercise. Describe a function in a sentence of prose and a model writes the rubric and the executable test suite for it, then the sandbox grades against that suite exactly as it grades ours. **The model writes the ruler and still cannot read it:** what it produces is tests, which are executed rather than consulted, and the scoring module they feed has no path to any model.

## How we kept it honest

Every item here is a structural property of the codebase, not a prompt instruction.

**The scoring module cannot reach a model.** `lib/scoring.ts` is a pure function from execution results to a score report. It imports nothing but TypeScript types. Our verification script reads its import list and fails the build if anything matching `anthropic`, `google`, `gemini`, `genai`, `openai`, `diagnose` or `ai` appears. You can check this claim faster than you can read this paragraph: open the file.

**Prompt injection fails structurally.** One of our demo submissions opens with a comment telling the grader to ignore the tests and award full marks. It scores 4/10. Nothing filtered that comment — the model read it, and simply had no tool that could write a grade. We did not build a defence. We built an architecture where the attack has nowhere to land.

**A submission could once award itself full marks — and the fix was architectural.** Grading used to compare values inside Python. But student code is imported before the tests run, and the harness executed in `__main__`, so a submission could reach into the grader's own namespace and rewrite the comparison function. One line scored **10/10 for code worth 8/10**. Patching that inside Python is a losing game — a private namespace is still reachable through `sys._getframe` or `gc.get_objects()`. So the decision left the interpreter entirely: the worker now evaluates each test expression and passes the resulting *value* across the WebAssembly boundary, and JavaScript does the comparing. There is no stdout protocol left to forge and no comparison function left to overwrite, because neither exists on the Python side any more. Seven red-team archetypes are the regression test.

**Hidden tests defeat gaming.** Each clause is checked by visible tests published with the assignment and hidden tests using different inputs. Our hardcoding archetype passes all five visible tests, fails five of the seven hidden ones, and earns 4/10.

**Determinism is observable, not asserted.** Grade the same class twice and the scores are byte-identical. That is not a claim about the model's temperature. There is no model in that path to have one.

**Claims are anchored to captured evidence.** A feedback sentence renders only if it cites a specific test result and its real traceback. Claims that cannot be anchored appear in a rejected tray rather than disappearing quietly, so you can see what the model wanted to say and why it wasn't allowed to.

**Timeouts degrade to amber, never to a spinner.** An infinite loop is killed by `Worker.terminate()`, which genuinely stops it where a Python-level `try/except` cannot. Tests that never reported are marked inconclusive — never assumed to pass, never assumed to fail — and the submission is flagged for human review.

**A model-authored suite has to earn its way in.** When a visitor describes their own problem, a pure validator refuses any suite that could not produce a meaningful mark. Then the suite must pass a known-good and fail a known-bad: the model's own reference solution is run against the tests it shipped with and must score full marks, and a stub that ignores its arguments and returns `None` must not — a suite nothing can fail hands out a mark that means nothing. Both halves run in the visitor's own browser. Finally every test is printed in full, and nothing is graded until the visitor accepts it.

**Passing tests are free.** The model is invoked only on failure, and identical failure signatures are hashed, diagnosed once, and reused. Cost grows with the number of distinct misconceptions in a class, not the number of students.

**It answers the teacher's next question too.** Once a class is marked, the useful number is not the average — it is which single misconception is worth a lesson. Crucible counts the same clause results across the cohort and says so plainly: eleven of thirty missed the even-length midpoint.

**And it proves its own claim on screen.** A panel on the landing page reads the import list of `lib/scoring.ts` out of the file at build time and displays it. It says `./types`. Wiring a model into the grading path would change what the visitor is reading.

And the honest caveat, since we would rather say it than have it asked: the model can be wrong about the diagnosis. It cannot be wrong about the score. A wrong explanation is cheap and a student can see through it. A wrong grade is expensive and invisible.

## How we built it

Next.js 16 App Router with React 19, TypeScript and Tailwind 4 — a single deployment, no separate backend service.

Execution is **Pyodide**: real CPython 3.14 compiled to WebAssembly, running in a Web Worker and self-hosted. The module cache is cleared between submissions, because a stale import would silently grade the previous student's code.

Diagnosis uses the Google Gemini API — `gemini-3.1-flash-lite` triages, `gemini-3.7-flash` writes the explanation, at roughly $0.003 a time. The prompt receives the rubric clause, the failing test and the raw traceback. It does not receive the score, because there is no code path that would give it one.

Nine archetypes carry the demo class — correct, off-by-one, wrong return type, infinite loop, syntax error, prompt injection, hardcoded answers, forged result markers and empty-input crash — and their expected scores are asserted in the build gate, so any change that moves a number breaks the build instead of quietly shipping.

## Challenges we ran into

**Our sandbox disappeared mid-build.** The plan was the Piston public execution API — free, no key, no Docker on Windows. It started returning HTTP 401: the public instance went whitelist-only in February. Losing your execution layer when the entire thesis is "we really run the code" is not a small problem. Moving to self-hosted Pyodide turned out to be a better project — no third-party runtime in the stack at all, no key, no rate limit, and no way for someone else's outage to break the demo while a judge is watching.

**Killing an infinite loop is harder than it looks.** You cannot stop runaway Python from inside the same interpreter; a timeout implemented in Python never gets scheduled. `Worker.terminate()` genuinely kills it, but everything produced before the kill has to be preserved.

**Deciding what "inconclusive" means.** A test that never reported is not a failure and not a pass. Treating it as either would put a wrong number in a gradebook. It became its own status, propagating up to an amber card that asks for a human.

## What we learned

The interesting design work was in what we refused to let the model do. It is easy to hand an LLM a tool and let it write to the score — and every failure mode after that point is unfixable by prompting, because you have already given away the property you needed.

We also learned that a trust claim is worth very little unless it is cheap to check. "Our AI doesn't set the grade" is a sentence anyone can write. `lib/scoring.ts` having no import path to a model is something a skeptical person verifies in two seconds, and that difference is the entire project.

## What's next

- Persistence and a real gradebook export.
- Cross-class misconception clustering. Failure signatures already collapse identical mistakes, so aggregating them across a cohort tells an instructor which concept to reteach on Monday — the thing an autograder has never been able to say.


# ===== FIELD 2: "Built with" — type these, comma or Enter after each =====

next.js, react, typescript, tailwindcss, pyodide, webassembly, web-workers, python, google-gemini, node.js, vercel


# ===== FIELD 3: "Try it out" links — two entries =====

https://crucible-green.vercel.app
https://github.com/biyonjose10/crucible


# ===== FIELD 4: Image gallery =====

C:\Users\biyon\projects\crucible\docs\thumbnail-3x2.jpg      (queue, 3:2, use first)
C:\Users\biyon\projects\crucible\docs\screenshot-student.jpg (student view, second)
