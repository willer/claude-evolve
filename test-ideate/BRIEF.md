# Project Brief

## Vision

We've been very excited by the possibilities and demonstrated performance of AlphaEvolve, and the potential
of OpenEvolve, a clone of AlphaEvolve. However, in testing, it hasn't worked super well, at least for design
of neural network architectures. It tended to evolve very slowly, and get caught up in local minima.

We would like to like to try a new idea, based on the success of the claude-fsd approach (in
../claude-fsd for reference). The claude-fsd package is a npm package based on simple shell scripts
that leans on `claude -p` to call the Claude Code coder to perform workhorse functions like planning,
architecting, and running a plan-develop-test loop until the projet is done. So with this `claude-evolve`
variant, we take the same approach for develop, but this is for algorithm development, using a
plan-develop-run-record loop, running test after test and recording the quantitative results, all
the while providing the human operator the opportunity to fill the tail end of the ideas pipeline
using `claude-evolve ideate` or just interactive conversations with an AI, or editing the file
directly.

## Core Requirements

Commands:

- claude-evolve -- runs a menu like with claude-fsd
- claude-evolve setup -- sets up the baseline evolution/ files if they're not present, and allows for editing the brief
- claude-evolve ideate [50] -- takes user input and launches `claude -p` to generate [param] new ideas
- claude-evolve run -- runs the plan-develop-run-record loop
- claude-evolve analyze -- shows a chart of performance and performance changes over time, and highlights the top candidate so far

Files:

- evolution/BRIEF.md -- a description of what the project is about and the goals of the thing to be evolved, as well as identifying the evolving algo baseline file and the evaluator file
- evolution/evolution.csv -- a list of all iterations, with columns ID,basedonID,description,performance,status
- evolution/evolution_details.md -- a description, for each ID, of the details of what should be changed or what did change, any commentary about the design or the performance, etc., all of which is optional
- evolution/evolution_id[id].py -- a copy of the tested algo version at that ID

The evaluator file takes the name of the file to test as its one argument, and outputs a dictionary with one performance metric as the output.

## Success Criteria

- Success criterion 1
- Success criterion 2
