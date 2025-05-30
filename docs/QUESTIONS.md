# Claude-Evolve Project – Clarifying Questions

Below is a focused list of open questions that surfaced while analysing the current BRIEF.md.  Answering them will prevent the development team (human and AI) from making incorrect assumptions during implementation.

## 1. Technical Architecture & Tooling

1. **Primary implementation language** – The brief references both npm (JavaScript/TypeScript) and Python artefacts.  Should the CLI itself be written in Node / TypeScript, Python, or a hybrid approach?
Let's keep it simple: shell script in a npm package, just like claude-fsd. I'm a curmudgeon this way.
The evaluator itself doesn't have to be python, but probably is. It's a good point, in that we shouldn't
just assume the file extension of the algo and evaluator are `py`.

2. **Package distribution** – Will claude-evolve be published to a public package registry (e.g. npm, PyPI) or consumed only from source?  This influences versioning and dependency policies.
public package, just like claude-fsd

3. **Prompt templates for Claude** – Are there predefined prompt skeletons the CLI should inject when calling `claude -p`, or should prompts be assembled dynamically from the project state?
We don't have the prompts now. Take a look at what's in claude-fsd, and use that to write something
that makes sense. We can tweak it after.

4. **Evaluator I/O contract** – Must the evaluator print a JSON string to stdout, write to a file, or return a Python dict via IPC?  Clarify the exact interface so automation can parse results reliably.
Evaluator must print a JSON dictionary to stdout.

## 2. Data & Persistence Model

5. **`evolution.csv` schema details** – Beyond the five columns listed, are additional fields (e.g. timestamp, random seed, hyper-parameters) required?  What fixed set of status codes are expected?
No additional fields required. Maybe status codes are just '' (meaning not yet implemented), 'failed', 'completed'?

6. **Large artefact storage** – If evolved algorithms produce sizeable checkpoints or models, should those be committed to git, stored in a separate artefact store, or ignored entirely?
Let's ignore entirely. The algorithm or evaluator will have to decide what to do with those files.
The initial use case for this involves an algorithm/evaluator that trains ML models in Modal, so 
that will exercise this idea.

## 3. Evolution Strategy & Workflow

7. **Selection policy** – How should the next parent candidate be chosen (best-so-far, weighted sampling, user selection)?  Is there a configurable strategy interface?
Parent candidate is based on basedonID. ID 000 is implied as the baseline. No weighted sampling or user
selection. This is an LLM-driven R&D system, not using any old mathy-type approaches like are in 
AlphaEvolve.

8. **Stopping condition** – What criteria (max iterations, plateau patience, absolute metric) should cause `claude-evolve run` to stop automatically?
Keep running until it's out of candidates.

9. **Parallel evaluations** – Is concurrent execution of evaluator jobs desirable?  If so, what is the preferred concurrency mechanism (threads, processes, external cluster)?
Interesting idea! This could be done in a shell script as well, but does that make it too complex?
It would have to be max N processes as the mechanism.

## 4. User Experience

10. **CLI menu vs. sub-commands** – Should the top-level invocation open an interactive menu akin to `claude-fsd`, or rely solely on explicit sub-commands for CI compatibility?
both as per `claude-fsd`.

11. **Real-time feedback** – During long evaluation runs, what information must be streamed to the terminal (metric values, logs, ETA)?
All of the above. Whatever the py files are saying, plus status and performance and iteration ID, etc.
by `claude-evolve`'s scripts.

12. **Manual idea injection** – Does `claude-evolve ideate` only generate ideas through Claude, or should it also allow the user to type free-form ideas that bypass the AI?
Totally the user could enter it at any time. Ideate could possibly allow them to edit the file directly,
like "Ask AI to add new ideas? [Y/n]", and "User directly add new ideas? [y/N]"

## 5. Analysis & Visualisation

13. **Charting library and medium** – Should `claude-evolve analyze` output an ASCII chart in the terminal, generate an HTML report, or open a matplotlib window?
I think `claude-evolve analyze` could make a png chart with ... I guess it would have to use node
somehow for this, given that this is an npm package?

14. **Metric aggregation** – If multiple performance metrics are introduced later, how should they be visualised and compared (radar chart, multi-line plot, table)?
No idea. Right now it's just a performance number.

## 6. Operations & Compliance

15. **Security of Claude calls** – Are there organisational constraints on sending source code or dataset snippets to Claude’s API (e.g. PII redaction, encryption at rest)?  Define any red-lines to avoid accidental data leakage.
There are not. Assume that's handled by the organization.

## 7. Development Process Issues

16. **Code Review Process** - How should we handle situations where developers falsely claim work completion without actually implementing anything?

**Context**: This issue has been resolved. Git repository has been properly initialized with comprehensive .gitignore, initial commit made, and proper development process established.

**Status**: ✅ RESOLVED - Git repository now properly initialized with comprehensive .gitignore covering Node.js dependencies, OS files, editor files, build outputs, and project-specific evolution artifacts. Initial commit completed with all project documentation.
## 8. Git Remote Repository Setup

17. **Git remote repository URL** – What remote repository URL should be used for the `claude-evolve` project (e.g., GitHub, GitLab, self-hosted)? This will allow configuring `git remote add origin <URL>` and pushing the initial `main` branch.