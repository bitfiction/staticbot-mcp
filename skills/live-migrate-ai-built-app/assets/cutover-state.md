# Live migration state — [app]

Do not commit this file to the builder's repository. No secrets.

## Current phase
- Phase: 0 · Last completed step: — · Updated: —

## Identity
- Builder / source type: 
- Source project or app ID: 
- Repository + builder branch: 
- Rehearsal migration ID / target project ref: 
- Final migration ID / target project ref: 
- Final-copy strategy: clean-and-reuse | fresh target
- Production domain: 
- Production stack / deployment ID / deploymentTarget / dns action: 
- Maintenance approach: A (maintenance version of the production stack) | B (builder maintenance version)
- A: V_app templateId + commit: 
- A: V_maint templateId + commit / revert commit: 
- A: auto-deploy off at / Continuous Sync paused at: 

## People
- Decision owner (go/no-go, reopening): 
- Operator (DNS, builder, freeze): 
- Support contact / status URL: 

## Saved DNS (verbatim, before any change)
| Name | Type | Value | TTL |
|---|---|---|---|

## Rehearsal results
- Preview URL: 
- Evidence problems / unverified items and their resolution: 
- Critical journeys tested and by whom: 
- Timings (discovery / transfer / total): 
- A: version swap rehearsal (V_app ⇄ V_maint): pass | fail | not run — swap duration: 
- Freeze rehearsal: pass | fail — duration: 

## Window
- Date, start–end, timezone: 
- Abort deadline: 
- TTL lowered to / at: 

## Writer table (freeze)
| Writer | Control | Probe (expected failure) | Probe result + time | Undo |
|---|---|---|---|---|

## Log
- [time] [event / decision / who]
