# Project Rules

## Background Tasks
Before launching ANY background bash task (`run_in_background`):
1. Stop ALL existing background tasks using `TaskStop` for each active task ID
2. Verify zero active tasks remain
3. Only then launch new tasks
4. Never have more than 2 background tasks: 1 bot + 1 scraper
