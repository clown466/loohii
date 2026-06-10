# Clip-First V1 Plan

## Goal

Move the production workflow from shot-first planning toward clip-first video production.

The clip is the smallest Seedance generation unit. A clip groups several 2-4 second shots into a 10-13 second production unit, with a hard maximum of 15 seconds.

## V1 Scope

- Keep the current `breakdownScenes` shot list for detailed editing.
- Add `workflowCenter.clips` as a derived production layer.
- Avoid new database tables in V1; store the clip layer inside project metadata.
- Keep model output lightweight. The backend derives clip metadata, control level, layout memory, Seedance prompt, and preflight checks deterministically.

## Backend

- Accept and return `clips` in the workflow draft API.
- Derive clips from rebalanced storyboard shots after text model generation.
- Derive clips for legacy projects when old workflow data has shots but no clips.
- Save clips in `workflowCenter`.
- Include clip count in workflow run responses.

## Frontend

- Add workflow clip types to the API client.
- Store and autosave clips with workflow drafts.
- Show a clip-first storyboard stage:
  - clip title and plot goal
  - estimated duration
  - dialogue density
  - scene, characters, control level, storyboard type
  - preflight pass/warnings
  - layout memory and Seedance prompt
  - included shots
- Preserve the existing shot list and shot editor.

## V1 Rules

- Target clip duration: 10-13 seconds.
- Maximum clip duration: 15 seconds.
- Dialogue density target for English fast comedy: 2.8-3.4 words per second.
- Dialogue density hard warning: above 3.6 words per second.
- Dialogue-heavy, multi-character, indoor, or continuity-sensitive clips use `hard` control with `multi_panel`.
- Action or emotion clips use `medium` control.
- Fight, chase, high-motion, low-dialogue clips use `soft` control with `start_end_keyframes`.
- Atmosphere or empty clips use `none` or `mood_reference`.

## Later

- Real TTS duration budgeting.
- Video QA evaluator.
- Repair router.
- Clip-level history and regeneration.
- User-adjustable control level and director freedom.
